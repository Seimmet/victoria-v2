import { Request, Response } from 'express';
import prisma from '../utils/prisma';

// Helper to convert Decimal to number
const toNumber = (value: any): number => {
    if (value && typeof value === 'object' && 'toNumber' in value) {
        return value.toNumber();
    }
    return Number(value || 0);
};

// 1. Get Dashboard Summary Stats
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
    try {
        // Total Revenue (from successful payments)
        const revenueResult = await prisma.payment.aggregate({
            _sum: { amount: true },
            where: { status: 'succeeded' }
        });
        const totalRevenue = toNumber(revenueResult._sum.amount);

        // Total Bookings
        const totalBookings = await prisma.booking.count();

        // Completed Bookings
        const completedBookings = await prisma.booking.count({
            where: { status: 'completed' }
        });

        // Cancelled Bookings
        const cancelledBookings = await prisma.booking.count({
            where: { status: 'cancelled' }
        });

        // New Customers (This Month)
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const newCustomers = await prisma.user.count({
            where: {
                role: 'customer',
                createdAt: { gte: startOfMonth }
            }
        });

        // Active Stylists
        const activeStylists = await prisma.stylist.count({
            where: { isActive: true }
        });

        // Active Customers (Total)
        const totalCustomers = await prisma.user.count({
            where: { role: 'customer' }
        });

        res.json({
            totalRevenue,
            totalBookings,
            completedBookings,
            cancelledBookings,
            newCustomers,
            activeStylists,
            totalCustomers
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ message: 'Error fetching dashboard stats' });
    }
};

// 2. Get Revenue Over Time (Last 30 days)
export const getRevenueStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const payments = await prisma.payment.findMany({
            where: {
                status: 'succeeded',
                createdAt: { gte: thirtyDaysAgo }
            },
            select: {
                amount: true,
                createdAt: true
            }
        });

        // Group by Date (YYYY-MM-DD)
        const revenueByDate: Record<string, number> = {};
        payments.forEach(payment => {
            const date = payment.createdAt.toISOString().split('T')[0];
            const amount = toNumber(payment.amount);
            revenueByDate[date] = (revenueByDate[date] || 0) + amount;
        });

        // Format for Recharts
        const chartData = Object.entries(revenueByDate).map(([date, amount]) => ({
            date,
            revenue: amount
        })).sort((a, b) => a.date.localeCompare(b.date));

        res.json(chartData);
    } catch (error) {
        console.error('Error fetching revenue stats:', error);
        res.status(500).json({ message: 'Error fetching revenue stats' });
    }
};

// 3. Get Bookings by Service
export const getServiceStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const bookings = await prisma.booking.findMany({
            where: { status: { not: 'cancelled' } },
            include: {
                style: {
                    select: { id: true, name: true }
                },
                payments: {
                    where: { status: 'succeeded' },
                    select: { amount: true }
                }
            }
        });

        // Group by service
        const statsMap = new Map<string, { name: string; bookings: number; revenue: number }>();

        bookings.forEach(booking => {
            if (!booking.style) return;

            const serviceId = booking.style.id;
            const serviceName = booking.style.name;
            
            // Sum up payments for this booking
            const bookingRevenue = booking.payments.reduce((sum, p) => sum + toNumber(p.amount), 0);

            if (!statsMap.has(serviceId)) {
                statsMap.set(serviceId, {
                    name: serviceName,
                    bookings: 0,
                    revenue: 0
                });
            }

            const stat = statsMap.get(serviceId)!;
            stat.bookings += 1;
            stat.revenue += bookingRevenue;
        });

        const serviceStats = Array.from(statsMap.values()).map(stat => ({
            name: stat.name,
            bookings: stat.bookings,
            estimatedRevenue: stat.revenue
        }));

        res.json(serviceStats);
    } catch (error) {
        console.error('Error fetching service stats:', error);
        res.status(500).json({ message: 'Error fetching service stats' });
    }
};

// 4. Get Bookings by Category
export const getCategoryStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const bookings = await prisma.booking.findMany({
            where: { status: { not: 'cancelled' } },
            include: {
                category: {
                    select: { id: true, name: true }
                },
                payments: {
                    where: { status: 'succeeded' },
                    select: { amount: true }
                }
            }
        });

        // Group by category
        const statsMap = new Map<string, { name: string; bookings: number; revenue: number }>();

        bookings.forEach(booking => {
            if (!booking.category) return;

            const categoryId = booking.category.id;
            const categoryName = booking.category.name;
            
            // Sum up payments for this booking
            const bookingRevenue = booking.payments.reduce((sum, p) => sum + toNumber(p.amount), 0);

            if (!statsMap.has(categoryId)) {
                statsMap.set(categoryId, {
                    name: categoryName,
                    bookings: 0,
                    revenue: 0
                });
            }

            const stat = statsMap.get(categoryId)!;
            stat.bookings += 1;
            stat.revenue += bookingRevenue;
        });

        const categoryStats = Array.from(statsMap.values()).map(stat => ({
            name: stat.name,
            bookings: stat.bookings,
            estimatedRevenue: stat.revenue
        }));

        res.json(categoryStats);
    } catch (error) {
        console.error('Error fetching category stats:', error);
        res.status(500).json({ message: 'Error fetching category stats' });
    }
};

// 5. Get Stylist Performance
export const getStylistStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const bookings = await prisma.booking.groupBy({
            by: ['stylistId'],
            _count: { id: true },
            where: { status: 'completed' } // Only count completed bookings for performance
        });

        // Fetch stylist names
        const stylistStats = await Promise.all(bookings.map(async (item) => {
            if (!item.stylistId) return null;
            const stylist = await prisma.stylist.findUnique({
                where: { id: item.stylistId },
                include: { user: { select: { fullName: true } } }
            });
            return {
                name: stylist?.user.fullName || 'Unknown',
                completedBookings: item._count.id
            };
        }));

        res.json(stylistStats.filter(Boolean));
    } catch (error) {
        console.error('Error fetching stylist stats:', error);
        res.status(500).json({ message: 'Error fetching stylist stats' });
    }
};
