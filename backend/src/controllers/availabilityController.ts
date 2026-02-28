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

    // 1. Get Active Stylists
    let activeStylists: { id: string, workingHours: any, user: { fullName: string }, leaves: { startDate: Date, endDate: Date }[] }[] = [];
    if (stylistId) {
        const where: any = { id: stylistId as string, isActive: true };
        if (styleId) {
            where.styles = { some: { id: styleId as string } };
        }

        const stylist = await prisma.stylist.findFirst({
            where,
            select: { 
                id: true, 
                workingHours: true, 
                user: { select: { fullName: true } },
                leaves: {
                    where: {
                         // Overlap check: Leave Start <= Range End AND Leave End >= Range Start
                         startDate: { lte: end },
                         endDate: { gte: start }
                    }
                }
            }
        });
        if (stylist) activeStylists = [stylist];
    } else {
        const where: any = { isActive: true };
        if (styleId) {
            where.styles = { some: { id: styleId as string } };
        }

        activeStylists = await prisma.stylist.findMany({
            where,
            select: { 
                id: true, 
                workingHours: true, 
                user: { select: { fullName: true } },
                leaves: {
                    where: {
                         startDate: { lte: end },
                         endDate: { gte: start }
                    }
                }
            }
        });
    }

    if (activeStylists.length === 0) {
        res.json(startDate && endDate ? {} : []); 
        return;
    }

    // 2. Fetch all bookings in range
    // We fetch ALL bookings (even for other stylists) if we need to calculate global capacity
    // But if a specific stylist is requested, we theoretically only care about them + unassigned
    // To be safe and simple, fetch all active bookings in range
    const whereBookings: any = {
        bookingDate: {
            gte: start,
            lte: end
        },
        status: { not: 'cancelled' }
    };

    if (excludeBookingId) {
        whereBookings.id = { not: excludeBookingId as string };
    }

    const bookings = await prisma.booking.findMany({
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

    // 3. Fetch Pricing for Duration Calculation
    // We need to know the duration of existing bookings to check for overlaps
    const allPricing = await prisma.stylePricing.findMany({
        select: {
            styleId: true,
            categoryId: true,
            durationMinutes: true
        }
    });

    const durationMap = new Map<string, number>();
    allPricing.forEach(p => {
        durationMap.set(`${p.styleId}_${p.categoryId}`, p.durationMinutes);
    });

    const getBookingDuration = (b: { styleId: string | null, categoryId: string | null }) => {
        if (!b.styleId || !b.categoryId) return 60;
        return durationMap.get(`${b.styleId}_${b.categoryId}`) || 60;
    };

    // 4. Fetch Business Hours
    const settings = await prisma.salonSettings.findFirst();
    const businessHours = (settings?.businessHours as any) || DEFAULT_BUSINESS_HOURS;
    const daysMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Helper to format date as YYYY-MM-DD
    const toDateString = (d: Date) => d.toISOString().split('T')[0];

    const result: Record<string, any[]> = {};
    const loopDate = new Date(start);

    while (loopDate <= end) {
        const dateKey = toDateString(loopDate);
        const dayOfWeek = loopDate.getUTCDay(); // 0 = Sunday
        const dayName = daysMap[dayOfWeek];
        const dayConfig = businessHours[dayName];

        // 1. Determine Effective Operating Range (Union of Global + Stylist Hours)
        let minStartHour = 24;
        let maxEndHour = 0;
        let isDayOpenGlobally = dayConfig && dayConfig.isOpen;

        if (isDayOpenGlobally) {
            minStartHour = parseInt(dayConfig.start.split(':')[0]);
            maxEndHour = parseInt(dayConfig.end.split(':')[0]);
        }

        // Check overrides from active stylists
        for (const stylist of activeStylists) {
            // Check if stylist is on leave
            const isStrictlyOnLeave = stylist.leaves.some(l => {
                return loopDate.getTime() >= l.startDate.getTime() && loopDate.getTime() <= l.endDate.getTime();
            });

            if (isStrictlyOnLeave) continue;

            if (stylist.workingHours) {
                const sSchedule = (stylist.workingHours as any)[dayName.toLowerCase()];
                if (sSchedule && sSchedule.isOpen && sSchedule.start && sSchedule.end) {
                    const sStart = parseInt(sSchedule.start.split(':')[0]);
                    const sEnd = parseInt(sSchedule.end.split(':')[0]);
                    
                    // If we found a working stylist, update range
                    if (sStart < minStartHour) minStartHour = sStart;
                    if (sEnd > maxEndHour) maxEndHour = sEnd;
                }
            }
        }

        if (minStartHour >= maxEndHour) {
            result[dateKey] = [];
        } else {
            const daySlots: { time: string; available: boolean; spots: number; stylists: { id: string; name: string; }[]; }[] = [];
            
            // Filter bookings for this day
            const dayBookings = bookings.filter(b => 
                toDateString(new Date(b.bookingDate)) === dateKey
            );

            for (let hour = minStartHour; hour < maxEndHour; hour++) {
                const timeString = `${hour.toString().padStart(2, '0')}:00:00`;
                
                // Construct Requested Slot Range
                const slotStartMinutes = hour * 60;
                const slotEndMinutes = slotStartMinutes + requestedDuration;

                // Check Availability
                let freeStylistsCount = 0;
                let unassignedConflictCount = 0;

                // 1. Calculate Unassigned Bookings Overlap
                const unassignedBookings = dayBookings.filter(b => !b.stylistId);
                for (const b of unassignedBookings) {
                    const bTime = new Date(b.bookingTime);
                    const bStartMinutes = bTime.getUTCHours() * 60 + bTime.getUTCMinutes();
                    const bDuration = getBookingDuration(b);
                    const bEndMinutes = bStartMinutes + bDuration;

                    if (slotStartMinutes < bEndMinutes && slotEndMinutes > bStartMinutes) {
                        unassignedConflictCount++;
                    }
                }

                // 2. Check Each Active Stylist
                const freeStylists: { id: string, name: string }[] = [];
                for (const stylist of activeStylists) {
                    
                    // Check if stylist is on leave
                    const isStrictlyOnLeave = stylist.leaves.some(l => {
                        return loopDate.getTime() >= l.startDate.getTime() && loopDate.getTime() <= l.endDate.getTime();
                    });

                    if (isStrictlyOnLeave) continue;

                    // Check specific working hours if defined
                    if (stylist.workingHours) {
                        const daySchedule = (stylist.workingHours as any)[dayName.toLowerCase()];
                        
                        // If explicitly marked as not working today
                        if (daySchedule && !daySchedule.isOpen) {
                            continue;
                        }

                        // If working hours are defined, check if slot fits
                        if (daySchedule && daySchedule.isOpen && daySchedule.start && daySchedule.end) {
                             const sStart = parseInt(daySchedule.start.split(':')[0]) * 60 + parseInt(daySchedule.start.split(':')[1] || '0');
                             const sEnd = parseInt(daySchedule.end.split(':')[0]) * 60 + parseInt(daySchedule.end.split(':')[1] || '0');
                             
                             if (slotStartMinutes < sStart || slotEndMinutes > sEnd) {
                                 continue;
                             }
                        }
                    } else {
                        // Fallback to Global Hours logic
                        if (!isDayOpenGlobally) {
                            continue; // Salon closed, stylist follows salon
                        }
                        
                        // Check against Global Hours
                        const gStart = parseInt(dayConfig.start.split(':')[0]) * 60 + parseInt(dayConfig.start.split(':')[1] || '0');
                        const gEnd = parseInt(dayConfig.end.split(':')[0]) * 60 + parseInt(dayConfig.end.split(':')[1] || '0');

                        if (slotStartMinutes < gStart || slotEndMinutes > gEnd) {
                            continue;
                        }
                    }

                    const stylistBookings = dayBookings.filter(b => b.stylistId === stylist.id);
                    let isStylistFree = true;

                    for (const b of stylistBookings) {
                        const bTime = new Date(b.bookingTime);
                        const bStartMinutes =bTime.getUTCHours() * 60 + bTime.getUTCMinutes();
                        const bDuration = getBookingDuration(b);
                        const bEndMinutes = bStartMinutes + bDuration;

                        if (slotStartMinutes < bEndMinutes && slotEndMinutes > bStartMinutes) {
                            isStylistFree = false;
                            break;
                        }
                    }

                    if (isStylistFree) {
                        freeStylists.push({ id: stylist.id, name: stylist.user.fullName });
                    }
                }

                // Final Calculation
                const finalSpots = freeStylists.length - unassignedConflictCount;

                if (finalSpots > 0) {
                    daySlots.push({
                        time: timeString.substring(0, 5), // "10:00"
                        available: true,
                        spots: finalSpots,
                        stylists: freeStylists
                    });
                }
            }
            result[dateKey] = daySlots;
        }

        // Next day
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
