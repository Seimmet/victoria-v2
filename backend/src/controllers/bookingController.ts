import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import Stripe from 'stripe';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { emailService } from '../services/emailService';
import { smsService } from '../services/smsService';
import { notificationQueue } from '../services/notificationQueueService';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_PLACEHOLDER', {
  apiVersion: '2025-01-27.acacia' as any,
});

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

const getStylistSurcharge = (stylist: any, styleId: string | null): number => {
    if (!stylist) return 0;
    
    // Check for style-specific surcharge first
    if (stylist.styleSurcharges && styleId) {
        const styleSurcharges = stylist.styleSurcharges as Record<string, number>;
        const specificSurcharge = Number(styleSurcharges[styleId]);
        
        // Only use specific surcharge if it is defined and greater than 0
        // If it is 0, we fall back to the global surcharge
        if (styleSurcharges[styleId] !== undefined && specificSurcharge > 0) {
            return specificSurcharge;
        }
    }
    
    // Fallback to base surcharge
    if (stylist.surcharge) {
        return Number(stylist.surcharge);
    }
    
    return 0;
};

const getPaymentSummary = (booking: any, price: number) => {
    const payments = booking.payments || [];
    const succeeded = payments.filter((p: any) => p.status === 'succeeded');
    const totalPaid = succeeded.reduce((sum: number, p: any) => sum + Number(p.amount), 0) || 0;
    let paymentStatus: 'pending' | 'deposit_paid' | 'paid_in_full' = 'pending';

    if (totalPaid > 0) {
        paymentStatus = 'deposit_paid';
        if (booking.status === 'completed') {
            const sorted = [...succeeded].sort((a, b) => a.id.localeCompare(b.id));
            const initialDeposit = sorted.length > 0 ? Number(sorted[0].amount) : 0;
            const targetTotal = price + initialDeposit;
            if (targetTotal > 0 && totalPaid >= targetTotal - 0.01) {
                paymentStatus = 'paid_in_full';
            }
        }
    }

    return { totalPaid, paymentStatus };
};

export const getBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const userRole = (req as any).user?.role;
    const userId = (req as any).user?.id;

    const whereClause: any = {};
    if (userRole === 'customer') {
        whereClause.customerId = userId;
    } else if (userRole === 'stylist') {
        // Find stylist record for this user
        const stylist = await prisma.stylist.findUnique({
            where: { userId: userId }
        });
        
        if (stylist) {
            whereClause.stylistId = stylist.id;
        } else {
            // If user is a stylist role but has no stylist record, they have no bookings
            res.json([]);
            return;
        }
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        customer: { select: { fullName: true, email: true, phone: true } },
        category: { select: { name: true } }, // Formerly Service (Variation)
        style: { select: { name: true } }, // Formerly Category (Main Style)
        stylist: { 
            include: { 
                user: { select: { id: true, fullName: true } }
            } 
        },
        promo: {
          select: {
            id: true,
            title: true,
            promoMonth: true,
            promoYear: true,
            discountPercentage: true,
            promoPrice: true,
            stylePricing: {
              select: {
                style: { select: { name: true } },
                category: { select: { name: true } }
              }
            }
          }
        },
        payments: true, 
      },
      orderBy: { bookingDate: 'desc' }
    });

    const bookingsWithPrice = await Promise.all(bookings.map(async (booking) => {
        let price = 0;
        let duration = 60;

        if (booking.styleId && booking.categoryId) {
            const pricing = await prisma.stylePricing.findUnique({
                where: {
                    styleId_categoryId: {
                        styleId: booking.styleId,
                        categoryId: booking.categoryId
                    }
                }
            });
            if (pricing) {
                price = Number(pricing.price);
                duration = pricing.durationMinutes;
            }
        }

        if (booking.stylist) {
             price += getStylistSurcharge(booking.stylist, booking.styleId);
        }
        const { totalPaid, paymentStatus } = getPaymentSummary(booking, price);
        
        return {
            ...booking,
            bookingDate: booking.bookingDate ? booking.bookingDate.toISOString().split('T')[0] : null,
            // Map for frontend compatibility or new structure
            serviceName: booking.category?.name,
            styleName: booking.style?.name,
            price,
            duration,
            totalPaid,
            paymentStatus
        };
    }));

    res.json(bookingsWithPrice);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching bookings' });
  }
};

import { NotificationType, NotificationChannel } from '@prisma/client';

export const createBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { styleId, categoryId, stylistId, date, time, guestDetails, paymentIntentId, promoId } = req.body;

    // Parse Date and Time
    // Date string YYYY-MM-DD to Date object (Force UTC)
    const bookingDate = new Date(date + 'T00:00:00Z');

    let userId = (req as any).user?.id;
    let createdUserPassword = '';

    // Validate Variation (formerly Category)
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
        res.status(400).json({ message: 'Invalid Variation (Category) ID' });
        return;
    }

    let serviceDisplayName = category.name;

    // Validate Style (formerly Service)
    if (styleId) {
         const style = await prisma.style.findUnique({ where: { id: styleId } });
         if (!style) {
             res.status(400).json({ message: 'Invalid Style ID' });
             return;
         }

         serviceDisplayName = category.name || style.name;

         // Validate Stylist Capability
         if (stylistId) {
            // Check if stylist is on leave
            const onLeave = await prisma.stylistLeave.findFirst({
                where: {
                    stylistId,
                    startDate: { lte: bookingDate },
                    endDate: { gte: bookingDate }
                }
            });

            if (onLeave) {
                res.status(400).json({ message: 'Selected stylist is on leave for this date.' });
                return;
            }

            const capableStylist = await prisma.stylist.findFirst({
                where: {
                    id: stylistId,
                    styles: { some: { id: styleId } }
                }
            });

            if (!capableStylist) {
                // If stylist exists but not capable. 
                // We should double check if stylistId is valid first, but findFirst handles it.
                // If stylistId is invalid, capableStylist is null.
                // If stylistId is valid but no relation, capableStylist is null.
                
                // Let's check if stylist exists at all to give better error
                const stylistExists = await prisma.stylist.findUnique({ where: { id: stylistId } });
                if (stylistExists) {
                     res.status(400).json({ message: 'Selected stylist cannot perform this style.' });
                     return;
                }
            }
         }
    }

    const settings = await prisma.salonSettings.findFirst();

    // Handle Guest Booking
    if (!userId) {
        if (!guestDetails || !guestDetails.fullName || !guestDetails.email || !guestDetails.phone) {
             res.status(400).json({ message: 'Guest details (Name, Email, Phone) are required' });
             return;
        }

        // Check if user exists with this email
        let user = await prisma.user.findUnique({ where: { email: guestDetails.email } });

        if (!user) {
            // Create new user for guest
            // Generate random password or placeholder
            const randomPassword = Math.random().toString(36).slice(-8);
            const passwordHash = await bcrypt.hash(randomPassword, 10);

            user = await prisma.user.create({
                data: {
                    fullName: guestDetails.fullName,
                    email: guestDetails.email,
                    phone: guestDetails.phone,
                    address: guestDetails.address || '',
                    role: 'customer',
                    passwordHash,
                    birthDay: guestDetails.birthDay ? Number(guestDetails.birthDay) : null,
                    birthMonth: guestDetails.birthMonth ? Number(guestDetails.birthMonth) : null,
                    notificationConsent: guestDetails.smsConsent ?? true,
                }
            });
            
            // Queue guest credentials email
            if (user.notificationConsent) {
                const { subject, html } = await emailService.getGuestCredentialsContent(guestDetails.fullName, randomPassword);
                await notificationQueue.add(
                    'EMAIL', 
                    'GN', 
                    guestDetails.email, 
                    html, 
                    subject, 
                    { type: 'GUEST_CREDENTIALS', userId: user.id }
                );
            }
        } else {
            // Update birthday if provided and not set
            if (guestDetails.birthDay && guestDetails.birthMonth && (!user.birthDay || !user.birthMonth)) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        birthDay: Number(guestDetails.birthDay),
                        birthMonth: Number(guestDetails.birthMonth)
                    }
                });
            }
        }
        
        userId = user.id;
    } else {
        // Logged in user - check for profile update (Birthday)
        if (guestDetails) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            const data: any = {};

            if (guestDetails.birthDay && guestDetails.birthMonth && user && (!user.birthDay || !user.birthMonth)) {
                data.birthDay = Number(guestDetails.birthDay);
                data.birthMonth = Number(guestDetails.birthMonth);
            }

            if (typeof (guestDetails as any).smsConsent === 'boolean') {
                data.notificationConsent = (guestDetails as any).smsConsent;
            }

            if (Object.keys(data).length > 0) {
                await prisma.user.update({
                    where: { id: userId },
                    data
                });
            }
        }
    }
    
    // Time string HH:mm to Date object (Epoch + Time) - Force UTC for Floating Time
    const timeParts = time.split(':');
    const bookingTime = new Date(0); // Epoch
    bookingTime.setUTCHours(Number(timeParts[0]));
    bookingTime.setUTCMinutes(Number(timeParts[1]));

    let result;
    try {
        result = await prisma.$transaction(async (tx) => {
            if (stylistId) {
                const existingBooking = await tx.booking.findFirst({
                    where: {
                        stylistId,
                        bookingDate,
                        bookingTime,
                        status: { not: 'cancelled' }
                    }
                });

                if (existingBooking) {
                    throw new Error('Selected stylist is no longer available at this time.');
                }
            } else {
                 const duplicateBooking = await tx.booking.findFirst({
                    where: {
                        customerId: userId,
                        bookingDate,
                        bookingTime,
                        status: { not: 'cancelled' }
                    }
                 });
                 if (duplicateBooking) {
                     throw new Error('You already have a booking at this time.');
                 }
            }

            const booking = await tx.booking.create({
                data: {
                    customerId: userId,
                    styleId,
                    categoryId,
                    stylistId: stylistId || null,
                    promoId: promoId || null,
                    bookingDate,
                    bookingTime,
                    status: 'booked',
                },
            });
            return booking;
        });
    } catch (transactionError: any) {
        console.error('Booking transaction failed:', transactionError);
        res.status(409).json({ message: transactionError.message || 'Booking failed.' });
        return;
    }

    // Notifications are now handled in addBookingPayment (after successful payment)
    // to prevent sending emails for failed/abandoned payments.

    res.status(201).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateBooking = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const { status, stylistId, paymentStatus, date, time } = req.body;

        const booking = await prisma.booking.findUnique({ 
            where: { id },
            include: { customer: true }
        });
        if (!booking) {
            res.status(404).json({ message: 'Booking not found' });
            return;
        }

        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;
        const requestEmail = req.body.email;

        // Security Check
        if (userId) {
             // Logged-in User
             if (userRole !== 'admin' && userRole !== 'stylist') {
                 if (booking.customerId !== userId) {
                     res.status(403).json({ message: 'Not authorized to update this booking' });
                     return;
                 }
                 // Customers can ONLY cancel
                 if (status !== 'cancelled') {
                      res.status(403).json({ message: 'Customers can only cancel bookings.' });
                      return;
                 }
             }
        } else {
             // Guest User (No Token)
             // Must verify email matches booking customer email
             if (!requestEmail || !booking.customer || booking.customer.email !== requestEmail) {
                  res.status(403).json({ message: 'Email verification failed for guest cancellation.' });
                  return;
             }
             if (status !== 'cancelled') {
                  res.status(403).json({ message: 'Guests can only cancel bookings.' });
                  return;
             }
        }

        const data: any = {};
        if (status) data.status = status;
        
        // Handle Rescheduling (Date/Time change)
        if (date && time) {
            // Parse Date and Time (same logic as createBooking - Force UTC)
            const parsedDate = new Date(date + 'T00:00:00Z');
            const timeParts = time.split(':');
            const parsedTime = new Date(0); // Epoch
            parsedTime.setUTCHours(Number(timeParts[0]));
            parsedTime.setUTCMinutes(Number(timeParts[1]));

            // Check if this new slot is available (basic conflict check)
            // If a stylist is assigned, check their availability
            const effectiveStylistId = stylistId || booking.stylistId;

            if (effectiveStylistId) {
                const conflict = await prisma.booking.findFirst({
                    where: {
                        stylistId: effectiveStylistId,
                        bookingDate: parsedDate,
                        bookingTime: parsedTime,
                        status: { not: 'cancelled' },
                        id: { not: id }
                    }
                });

                if (conflict) {
                    res.status(409).json({ message: 'The assigned stylist is already booked at this time.' });
                    return;
                }
            }

            data.bookingDate = parsedDate;
            data.bookingTime = parsedTime;
        }
        
        if (stylistId) {
            if (stylistId === 'unassigned') {
                data.stylistId = null;
            } else {
                // Check Capability
                if (booking.styleId) {
                    const capableStylist = await prisma.stylist.findFirst({
                        where: {
                            id: stylistId,
                            styles: { some: { id: booking.styleId } }
                        }
                    });
                    if (!capableStylist) {
                         res.status(400).json({ message: 'Selected stylist cannot perform this style.' });
                         return;
                    }
                }

                // Check if stylist is already booked at this time (use new date/time if provided, else current)
                // Note: If we just parsed date/time above, we should use that. 
                // However, date/time variables are strings, data.bookingDate is Date.
                
                const targetDate = (date && time) ? data.bookingDate : booking.bookingDate;
                const targetTime = (date && time) ? data.bookingTime : booking.bookingTime;

                const conflict = await prisma.booking.findFirst({
                    where: {
                        stylistId,
                        bookingDate: targetDate,
                        bookingTime: targetTime,
                        status: { not: 'cancelled' },
                        id: { not: id }
                    }
                });

                if (conflict) {
                    res.status(409).json({ message: 'Stylist is already booked at this time' });
                    return;
                }
                data.stylistId = stylistId;
            }
        }
        
        // If updating payment status
        if (paymentStatus) {
            await prisma.payment.updateMany({
                where: { bookingId: id },
                data: { status: paymentStatus }
            });
        }

        const updatedBooking = await prisma.booking.update({
            where: { id },
            data,
            include: {
                customer: { select: { fullName: true, email: true, phone: true } },
                category: { select: { name: true } },
                style: { select: { name: true } },
                stylist: { 
                    include: { 
                        user: { select: { fullName: true } }
                    } 
                },
                payments: true, 
            }
        });

        let price = 0;
        const b = updatedBooking;
        if (b.styleId && b.categoryId) {
             const pricing = await prisma.stylePricing.findUnique({
                 where: {
                     styleId_categoryId: {
                         styleId: b.styleId,
                         categoryId: b.categoryId
                     }
                 }
             });
             if (pricing) price = Number(pricing.price);
        }

        // Add Stylist Surcharge
        if (b.stylist) {
             price += getStylistSurcharge(b.stylist, b.styleId);
        }

        const responseBooking = {
            ...updatedBooking,
            bookingDate: updatedBooking.bookingDate ? updatedBooking.bookingDate.toISOString().split('T')[0] : null,
            serviceName: b.category?.name,
            styleName: b.style?.name,
            price
        };

        // Check for status change to 'completed'
        if (status === 'completed' && booking.status !== 'completed') {
             const customer = (updatedBooking as any).customer;
             const category = (updatedBooking as any).category;
             
             if (customer && customer.notificationConsent) {
                 // Queue Thank You Email
                 if (customer.email) {
                     const { subject, html } = await emailService.getBookingCompletionContent(customer.fullName, category?.name || 'Service');
                     await notificationQueue.add(
                         'EMAIL', 
                         'BN', 
                         customer.email, 
                         html, 
                         subject, 
                         { bookingId: id, userId: customer.id }
                     );
                 }
                 
                 // Queue Thank You SMS
                 if (customer.phone) {
                     const smsBody = await smsService.getBookingCompletionContent(customer.fullName);
                     await notificationQueue.add(
                         'SMS', 
                         'BN', 
                         customer.phone, 
                         smsBody, 
                         undefined, 
                         { bookingId: id, userId: customer.id }
                     );
                 }
             }
        }

        res.json(responseBooking);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error updating booking' });
    }
};

export const checkInBooking = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;

        const booking = await prisma.booking.findUnique({ where: { id } });
        if (!booking) {
            res.status(404).json({ message: 'Booking not found' });
            return;
        }

        // Authorization: Admin, Stylist, or the Customer who owns the booking
        if (userRole !== 'admin' && userRole !== 'stylist' && booking.customerId !== userId) {
            res.status(403).json({ message: 'Not authorized to check in this booking' });
            return;
        }

        // Time Validation (Relaxed 30 mins)
        const now = new Date();
        const bookingDate = new Date(booking.bookingDate);
        const bookingTime = new Date(booking.bookingTime);
        
        // Construct appointment datetime (UTC)
        const appointmentTime = new Date(bookingDate);
        appointmentTime.setUTCHours(bookingTime.getUTCHours());
        appointmentTime.setUTCMinutes(bookingTime.getUTCMinutes());
        appointmentTime.setUTCSeconds(0);
        
        const diffMs = now.getTime() - appointmentTime.getTime();
        const diffMinutes = diffMs / (1000 * 60);

        // Debug log
        console.log(`Check-in Attempt: Now=${now.toISOString()}, Appt=${appointmentTime.toISOString()}, Diff=${diffMinutes}m`);

        if (Math.abs(diffMinutes) > 30) {
             res.status(400).json({ message: 'Check-in only allowed 30 minutes before or after appointment' });
             return;
        }

        // Update status
        const updatedBooking = await prisma.booking.update({
            where: { id },
            data: { status: 'checked_in' }
        });

        res.json({
            ...updatedBooking,
            bookingDate: updatedBooking.bookingDate ? updatedBooking.bookingDate.toISOString().split('T')[0] : null
        });

    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ message: 'Error checking in' });
    }
};

export const createPaymentIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, guestDetails } = req.body;
    
    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // amount in cents
      currency: 'usd',
      receipt_email: guestDetails?.email,
      description: guestDetails ? `Deposit for ${guestDetails.fullName}` : undefined,
      metadata: {
        customer_name: guestDetails?.fullName,
        customer_phone: guestDetails?.phone,
        customer_email: guestDetails?.email
      },
       automatic_payment_methods: { enabled: false },
       payment_method_types: ["card"]
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating payment intent' });
  }
};

export const createBookingPaymentIntent = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const { amount } = req.body; // Amount in cents

        const booking = await prisma.booking.findUnique({
            where: { id },
            include: { customer: true }
        });

        if (!booking) {
            res.status(404).json({ message: 'Booking not found' });
            return;
        }

        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;

        if (userRole && userRole !== 'admin' && userRole !== 'stylist' && booking.customerId !== userId) {
            res.status(403).json({ message: 'Not authorized to create payment for this booking' });
            return;
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'usd',
            metadata: { bookingId: id },
            automatic_payment_methods: { enabled: false },
            payment_method_types: ["card"]
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id
        });
    } catch (error) {
        console.error('Error creating booking payment intent:', error);
        res.status(500).json({ message: 'Error creating payment intent' });
    }
};

export const addBookingPayment = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const { amount, method, stripePaymentId } = req.body; // Amount in dollars

        const existingBooking = await prisma.booking.findUnique({
            where: { id },
            include: { customer: true }
        });

        if (!existingBooking) {
            res.status(404).json({ message: 'Booking not found' });
            return;
        }

        const userId = (req as any).user?.id;
        const userRole = (req as any).user?.role;

        if (userRole && userRole !== 'admin' && userRole !== 'stylist' && existingBooking.customerId !== userId) {
            res.status(403).json({ message: 'Not authorized to add payment for this booking' });
            return;
        }

        const payment = await prisma.payment.create({
            data: {
                bookingId: id,
                amount: amount,
                stripePaymentId: stripePaymentId || `cash_${Date.now()}`,
                status: 'succeeded'
            }
        });

        // Check if full payment (simplified logic, real world would compare total price)
        // For now, if payment added manually, we might want to update status or just log it.
        // We return the updated booking with payments
        const booking = await prisma.booking.findUnique({
            where: { id },
            include: { 
                payments: true,
                customer: { select: { id: true, fullName: true, email: true, phone: true, notificationConsent: true } },
                category: { select: { name: true } },
                style: { select: { name: true } },
                stylist: { include: { user: { select: { id: true, fullName: true } } } }
            }
        });

        if (booking && (booking as any).customer && (booking as any).customer.notificationConsent) {
            const customer = (booking as any).customer;
            
            // --- Send Booking Confirmation (Moved from createBooking) ---
            // Only send if this is the first payment (initial deposit)
            if (booking.payments && booking.payments.length === 1) {
                const serviceName = booking.category?.name || booking.style?.name || 'Service';
                const bookingDateStr = booking.bookingDate.toISOString().split('T')[0];
                
                // Format time HH:mm from UTC Date object
                const timeObj = new Date(booking.bookingTime);
                const hours = timeObj.getUTCHours().toString().padStart(2, '0');
                const minutes = timeObj.getUTCMinutes().toString().padStart(2, '0');
                const bookingTimeStr = `${hours}:${minutes}`;

                // Email Confirmation
                if (customer.email) {
                    const { subject, html } = await emailService.getBookingConfirmationContent(
                        customer.fullName, 
                        serviceName,
                        bookingDateStr, 
                        bookingTimeStr, 
                        false // Treat as registered user since they have a record
                    );
                    await notificationQueue.add(
                        'EMAIL', 
                        'BN', 
                        customer.email, 
                        html, 
                        subject, 
                        { bookingId: id, userId: customer.id }
                    );
                }

                // SMS Confirmation
                 if (customer.phone) {
                    const smsBody = await smsService.getBookingConfirmationContent(customer.fullName, bookingDateStr, bookingTimeStr);
                    await notificationQueue.add(
                        'SMS', 
                        'BN', 
                        customer.phone, 
                        smsBody, 
                        undefined, 
                        { bookingId: id, userId: customer.id }
                    );
                }
            }
            // -----------------------------------------------------------

            const dateStr = new Date().toLocaleDateString();

            // Send Email Receipt
            if (customer.email) {
                const { subject, html } = await emailService.getPaymentReceiptContent(
                    customer.fullName,
                    String(amount),
                    dateStr,
                    payment.stripePaymentId || 'N/A'
                );
                
                await notificationQueue.add(
                    'EMAIL',
                    'PN',
                    customer.email,
                    html,
                    subject,
                    { bookingId: id, paymentId: payment.id, type: 'PAYMENT_RECEIPT' }
                );
            }

            // Send SMS Receipt
            if (customer.phone) {
                const smsBody = await smsService.getPaymentReceiptContent(customer.fullName, String(amount));
                
                await notificationQueue.add(
                    'SMS',
                    'PN',
                    customer.phone,
                    smsBody,
                    undefined,
                    { bookingId: id, paymentId: payment.id, type: 'PAYMENT_RECEIPT' }
                );
            }
        }

        if (!booking) {
            res.status(404).json({ message: 'Booking not found' });
            return;
        }

        let price = 0;
        if (booking.styleId && booking.categoryId) {
            const pricing = await prisma.stylePricing.findUnique({
                where: {
                    styleId_categoryId: {
                        styleId: booking.styleId,
                        categoryId: booking.categoryId
                    }
                }
            });
            if (pricing) {
                price = Number(pricing.price);
            }
        }
        if (booking.stylist) {
            price += getStylistSurcharge(booking.stylist, booking.styleId);
        }

        const { totalPaid, paymentStatus } = getPaymentSummary(booking, price);

        res.json({
            ...booking,
            bookingDate: booking.bookingDate ? booking.bookingDate.toISOString().split('T')[0] : null,
            price,
            totalPaid,
            paymentStatus
        });
    } catch (error) {
        console.error('Error adding payment:', error);
        res.status(500).json({ message: 'Error adding payment' });
    }
};
