import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Calendar, DollarSign, Users, Scissors, TrendingUp, Clock } from "lucide-react";
import { authService, User } from "@/services/authService";
import { getDashboardStats, getRevenueStats } from "@/services/reportsService";
import { useSettings } from "@/contexts/SettingsContext";
import styleBohoLocs from '@/assets/style-boho-locs.jpg';
import styleBoxBraids from '@/assets/style-box-braids.jpg';
import styleCornrows from '@/assets/style-cornrows.jpg';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  total: {
    label: "Total",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

const Overview = () => {
  const { settings } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [revenueData, setRevenueData] = useState<any[]>([]);

  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    setUser(currentUser);

    const fetchData = async () => {
      try {
        if (currentUser?.role === 'admin') {
          const [dashboardStats, revenueStats] = await Promise.all([
            getDashboardStats(),
            getRevenueStats()
          ]);
          setStats(dashboardStats);
          
          // Format revenue data for chart
          const formattedRevenue = revenueStats.map((item: any) => ({
            name: new Date(item.date).toLocaleDateString('en-US', { weekday: 'short' }),
            total: item.revenue
          }));
          setRevenueData(formattedRevenue);
        }
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      }
    };

    fetchData();
  }, []);

  if (!user) return null;

  // Placeholder data if no dynamic data
  const adminData = revenueData.length > 0 ? revenueData : [
    { name: "Mon", total: 0 },
    { name: "Tue", total: 0 },
    { name: "Wed", total: 0 },
    { name: "Thu", total: 0 },
    { name: "Fri", total: 0 },
    { name: "Sat", total: 0 },
  ];

  const stylistData = [
    { name: "Mon", total: 3 },
    { name: "Tue", total: 5 },
    { name: "Wed", total: 4 },
    { name: "Thu", total: 6 },
    { name: "Fri", total: 8 },
    { name: "Sat", total: 9 },
  ];

  const getRoleContent = () => {
    switch (user.role) {
      case "admin":
        return (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${stats?.totalRevenue?.toLocaleString() || "0.00"}</div>
                  <p className="text-xs text-muted-foreground">+20.1% from last month</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Bookings</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalBookings || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats?.completedBookings || 0} completed, {stats?.cancelledBookings || 0} cancelled
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Stylists</CardTitle>
                  <Scissors className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.activeStylists || 0}</div>
                  <p className="text-xs text-muted-foreground">Available for booking</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Customers</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalCustomers || 0}</div>
                  <p className="text-xs text-muted-foreground">+{stats?.newCustomers || 0} new this month</p>
                </CardContent>
              </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7 mt-4">
              <Card className="col-span-4">
                <CardHeader>
                  <CardTitle>Weekly Revenue</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                  <ChartContainer config={chartConfig} className="h-[350px] w-full">
                    <BarChart data={adminData}>
                      <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="total" fill="currentColor" radius={[4, 4, 0, 0]} className="fill-gold" />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
              <Card className="col-span-3">
                <CardHeader>
                  <CardTitle>Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-8">
                    <div className="flex items-center">
                      <div className="ml-4 space-y-1">
                        <p className="text-sm font-medium leading-none">New Booking: Sarah Johnson</p>
                        <p className="text-sm text-muted-foreground">Knotless Braids with Amanda</p>
                      </div>
                      <div className="ml-auto font-medium text-gold">+ $150.00</div>
                    </div>
                    <div className="flex items-center">
                      <div className="ml-4 space-y-1">
                        <p className="text-sm font-medium leading-none">New Stylist Added</p>
                        <p className="text-sm text-muted-foreground">Jessica Williams joined the team</p>
                      </div>
                      <div className="ml-auto font-medium text-muted-foreground">2m ago</div>
                    </div>
                    <div className="flex items-center">
                      <div className="ml-4 space-y-1">
                        <p className="text-sm font-medium leading-none">Booking Cancelled</p>
                        <p className="text-sm text-muted-foreground">Refund processed for ID #4291</p>
                      </div>
                      <div className="ml-auto font-medium text-red-500">
                        - ${settings?.depositAmount ? Number(settings.depositAmount).toFixed(2) : "50.00"}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        );

      case "stylist":
        return (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Upcoming Appointments</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">8</div>
                  <p className="text-xs text-muted-foreground">For this week</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Today's Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">$450.00</div>
                  <p className="text-xs text-muted-foreground">3 appointments completed</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Client Rating</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">4.9</div>
                  <p className="text-xs text-muted-foreground">Based on 124 reviews</p>
                </CardContent>
              </Card>
            </div>
            <div className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Weekly Appointments</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                  <ChartContainer config={chartConfig} className="h-[350px] w-full">
                    <BarChart data={stylistData}>
                      <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="total" fill="currentColor" radius={[4, 4, 0, 0]} className="fill-gold" />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          </>
        );

      case "customer":
      default:
        return (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card className="bg-gradient-to-br from-gold/20 to-cream/30 border-gold/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-charcoal">Loyalty Points</CardTitle>
                  <TrendingUp className="h-4 w-4 text-gold" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gold-dark">150</div>
                  <p className="text-xs text-gray-600">Earn 50 more for a free wash!</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Next Appointment</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">Jun 12</div>
                  <p className="text-xs text-muted-foreground">10:00 AM with Amanda</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Visits</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">8</div>
                  <p className="text-xs text-muted-foreground">Since Jan 2025</p>
                </CardContent>
              </Card>
            </div>
            
            <div className="mt-8">
              <h3 className="text-lg font-medium mb-4">Recommended Styles for You</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer">
                    <img src={styleBohoLocs} alt="Boho Locs" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                       <span className="text-white font-medium">Boho Locs</span>
                    </div>
                 </div>
                 <div className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer">
                    <img src={styleBoxBraids} alt="Box Braids" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                       <span className="text-white font-medium">Box Braids</span>
                    </div>
                 </div>
                 <div className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer">
                    <img src={styleCornrows} alt="Cornrows" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                       <span className="text-white font-medium">Cornrows</span>
                    </div>
                 </div>
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight text-charcoal">Dashboard</h2>
        <p className="text-muted-foreground">Overview of your activity and performance.</p>
      </div>
      {getRoleContent()}
    </div>
  );
};

export default Overview;
