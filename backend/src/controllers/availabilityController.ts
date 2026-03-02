import { Request, Response } from 'express';
import prisma from '../utils/prisma';

const DEFAULT_BUSINESS_HOURS = {
  monday: { start: "09:00", end: "22:00", isOpen: true },
  tuesday: { start: "09:00", end: "22:00", isOpen: true },
  wednesday: { start: "09:00", end: "22:00", isOpen: true },
  thursday: { start: "09:00", end: "22:00", isOpen: true },
  friday: { start: "09:00", end: "22:00", isOpen: true },
  saturday: { start: "09:00", end: "22:00", isOpen: true },
  sunday: { start: "09:00", end: "22:00", isOpen: true },
};

// Helper: Parse "HH:MM" to minutes
const parseTime = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + (minutes || 0);
};

// Helper: Format Date to YYYY-MM-DD
const toDateString = (d: Date) => d.toISOString().split('T')[0];

export const getAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const { date, startDate, endDate, categoryId, styleId, stylistId, duration, excludeBookingId } = req.query;
    
    // Determine date range
    let start: Date;
    let end: Date;

    if (startDate && endDate) {
        start = new Date(startDate as string);
        end = new Date(endDate as string);
    } else if (date) {
          start = new Date(date as string);
          end = new Date(date as string);
    } else {
       res.status(400).json({ message: 'Date or startDate/endDate is required' });
       return;
    }

    // Validate dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
    }

    const requestedDuration = duration ? parseInt(duration as string) : 60;

    // --- 1. Parallel DB Fetching ---
    
    // A. Fetch Stylists
    const fetchStylists = async () => {
        const select = { 
            id: true, 
            workingHours: true, 
            user: { select: { fullName: true } },
            leaves: {
                where: {
                     startDate: { lte: end },
                     endDate: { gte: start }
                }
            }
        };

        const where: any = { isActive: true };
        if (stylistId) where.id = stylistId as string;
        if (styleId) where.styles = { some: { id: styleId as string } };

        if (stylistId) {
            const stylist = await prisma.stylist.findFirst({ where, select });
            return stylist ? [stylist] : [];
        } else {
            return prisma.stylist.findMany({ where, select });
        }
    };

    // B. Fetch Bookings
    const fetchBookings = async () => {
        const whereBookings: any = {
            bookingDate: { gte: start, lte: end },
            status: { not: 'cancelled' }
        };
        if (excludeBookingId) {
            whereBookings.id = { not: excludeBookingId as string };
        }
        return prisma.booking.findMany({
            where: whereBookings,
            select: {
                id: true,
                bookingDate: true,
                bookingTime: true,
                stylistId: true,
                styleId: true,
                categoryId: true
            }
        });
    };

    // C. Fetch Pricing (for durations)
    const fetchPricing = async () => {
        return prisma.stylePricing.findMany({
            select: { styleId: true, categoryId: true, durationMinutes: true }
        });
    };

    // D. Fetch Settings
    const fetchSettings = async () => {
        return prisma.salonSettings.findFirst();
    };

    // Execute all queries in parallel
    const [activeStylists, bookings, allPricing, settings] = await Promise.all([
        fetchStylists(),
        fetchBookings(),
        fetchPricing(),
        fetchSettings()
    ]);

    if (activeStylists.length === 0) {
        res.json(startDate && endDate ? {} : []); 
        return;
    }

    // --- 2. Pre-processing & Indexing ---

    // Build Duration Map
    const durationMap = new Map<string, number>();
    allPricing.forEach(p => {
        durationMap.set(`${p.styleId}_${p.categoryId}`, p.durationMinutes);
    });
    
    const getBookingDuration = (styleId: string | null, categoryId: string | null) => {
        if (!styleId || !categoryId) return 60;
        return durationMap.get(`${styleId}_${categoryId}`) || 60;
    };

    // Group Bookings by Date & Pre-calculate Minutes
    // Structure: Map<DateString, { unassigned: {start, end}[], byStylist: Map<StylistId, {start, end}[]> }>
    const bookingsByDate = new Map<string, { unassigned: {start: number, end: number}[], byStylist: Map<string, {start: number, end: number}[]> }>();

    bookings.forEach(b => {
        const dateKey = toDateString(new Date(b.bookingDate));
        
        if (!bookingsByDate.has(dateKey)) {
            bookingsByDate.set(dateKey, { unassigned: [], byStylist: new Map() });
        }
        
        const dayGroup = bookingsByDate.get(dateKey)!;
        
        // Calculate start/end minutes
        const bTime = new Date(b.bookingTime);
        const startMinutes = bTime.getUTCHours() * 60 + bTime.getUTCMinutes();
        const duration = getBookingDuration(b.styleId, b.categoryId);
        const endMinutes = startMinutes + duration;
        
        const processedBooking = { start: startMinutes, end: endMinutes };

        if (b.stylistId) {
            if (!dayGroup.byStylist.has(b.stylistId)) {
                dayGroup.byStylist.set(b.stylistId, []);
            }
            dayGroup.byStylist.get(b.stylistId)!.push(processedBooking);
        } else {
            dayGroup.unassigned.push(processedBooking);
        }
    });

    // Prepare Business Hours
    const businessHours = (settings?.businessHours as any) || DEFAULT_BUSINESS_HOURS;
    const daysMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    const result: Record<string, any[]> = {};
    const loopDate = new Date(start);

    // --- 3. Optimized Main Loop ---
    while (loopDate <= end) {
        const dateKey = toDateString(loopDate);
        const dayOfWeek = loopDate.getUTCDay();
        const dayName = daysMap[dayOfWeek];
        const dayConfig = businessHours[dayName];
        
        // Get pre-grouped bookings for this day
        const dayBookings = bookingsByDate.get(dateKey) || { unassigned: [], byStylist: new Map() };

        // Determine Effective Operating Range
        let minStartHour = 24;
        let maxEndHour = 0;
        let isDayOpenGlobally = dayConfig && dayConfig.isOpen;

        let globalStartMinutes = 0;
        let globalEndMinutes = 0;

        if (isDayOpenGlobally) {
            minStartHour = parseInt(dayConfig.start.split(':')[0]);
            maxEndHour = parseInt(dayConfig.end.split(':')[0]);
            globalStartMinutes = parseTime(dayConfig.start);
            globalEndMinutes = parseTime(dayConfig.end);
        }

        // Identify Valid Stylists for THIS Day (and their working hours)
        const validStylistsForDay: { id: string, name: string, start: number, end: number, bookings: {start: number, end: number}[] }[] = [];
        
        for (const stylist of activeStylists) {
            // Check Leave (Timestamp comparison)
            const isOnLeave = stylist.leaves.some(l => 
                loopDate.getTime() >= l.startDate.getTime() && loopDate.getTime() <= l.endDate.getTime()
            );
            if (isOnLeave) continue;

            let sStart = -1;
            let sEnd = -1;

            if (stylist.workingHours) {
                const sSchedule = (stylist.workingHours as any)[dayName.toLowerCase()];
                if (sSchedule && sSchedule.isOpen && sSchedule.start && sSchedule.end) {
                    sStart = parseTime(sSchedule.start);
                    sEnd = parseTime(sSchedule.end);
                    
                    // Update daily range
                    const sStartHour = Math.floor(sStart / 60);
                    const sEndHour = Math.ceil(sEnd / 60); 
                    
                    if (sStartHour < minStartHour) minStartHour = sStartHour;
                    if (sEndHour > maxEndHour) maxEndHour = sEndHour;
                } else if (sSchedule && !sSchedule.isOpen) {
                    continue; // Explicitly closed
                }
            } 
            
            // Fallback to Global Hours
            if (sStart === -1 && isDayOpenGlobally) {
                sStart = globalStartMinutes;
                sEnd = globalEndMinutes;
            }

            if (sStart !== -1) {
                validStylistsForDay.push({
                    id: stylist.id,
                    name: stylist.user.fullName,
                    start: sStart,
                    end: sEnd,
                    bookings: dayBookings.byStylist.get(stylist.id) || []
                });
            }
        }

        if (minStartHour >= maxEndHour || validStylistsForDay.length === 0) {
            result[dateKey] = [];
        } else {
            const daySlots: any[] = [];
            
            // Loop through hours
            for (let hour = minStartHour; hour < maxEndHour; hour++) {
                const slotStartMinutes = hour * 60;
                const slotEndMinutes = slotStartMinutes + requestedDuration;
                const timeString = `${hour.toString().padStart(2, '0')}:00`;

                // A. Check Unassigned Bookings Overlap
                let unassignedConflictCount = 0;
                for (const b of dayBookings.unassigned) {
                    // Overlap logic: (StartA < EndB) and (EndA > StartB)
                    if (slotStartMinutes < b.end && slotEndMinutes > b.start) {
                        unassignedConflictCount++;
                    }
                }

                // B. Check Each Valid Stylist
                const freeStylists: { id: string, name: string }[] = [];
                
                for (const stylist of validStylistsForDay) {
                    // 1. Check Working Hours
                    if (slotStartMinutes < stylist.start || slotEndMinutes > stylist.end) {
                        continue;
                    }

                    // 2. Check Stylist Bookings
                    let isStylistFree = true;
                    for (const b of stylist.bookings) {
                        if (slotStartMinutes < b.end && slotEndMinutes > b.start) {
                            isStylistFree = false;
                            break;
                        }
                    }

                    if (isStylistFree) {
                        freeStylists.push({ id: stylist.id, name: stylist.name });
                    }
                }

                const finalSpots = freeStylists.length - unassignedConflictCount;

                if (finalSpots > 0) {
                    daySlots.push({
                        time: timeString,
                        available: true,
                        spots: finalSpots,
                        stylists: freeStylists
                    });
                }
            }
            result[dateKey] = daySlots;
        }

        loopDate.setDate(loopDate.getUTCDate() + 1);
    }

    // Return array if single date (legacy support), object if range
    if (startDate && endDate) {
        res.json(result);
    } else {
        res.json(result[toDateString(start)] || []);
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching availability' });
  }
};

export const setAvailability = async (req: Request, res: Response) => {
  try {
    const { date, time, stylistCount } = req.body;
    
    // Upsert availability
    const availability = await prisma.availability.upsert({
      where: {
        date_timeSlot: {
            date: new Date(date),
            timeSlot: new Date(`1970-01-01T${time}`)
        }
      },
      update: { stylistCount },
      create: {
        date: new Date(date),
        timeSlot: new Date(`1970-01-01T${time}`),
        stylistCount,
      },
    });

    res.json(availability);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error setting availability' });
  }
};
