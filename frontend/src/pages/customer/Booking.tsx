import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { format, addDays, startOfDay, isSameDay } from 'date-fns';
import { Check, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, User, CreditCard, Loader2 } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

import { styleService, Style } from '@/services/styleService';
import { bookingService, TimeSlot, GuestDetails } from '@/services/bookingService';
import { stylistService, Stylist } from '@/services/stylistService';
import { authService } from '@/services/authService';
import CheckoutForm from '@/components/CheckoutForm';
import { SALON_INFO } from '@/config';
import { getActivePromos, MonthlyPromo } from '@/services/promoService';


import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { userService } from '@/services/userService';
import { bookingPolicyService } from '@/services/bookingPolicyService';
import { settingsService, SalonSettings } from '@/services/settingsService';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_PLACEHOLDER');

export default function Booking() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isLoggedIn = !!authService.getToken();

  // --- Global State ---
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [policyContent, setPolicyContent] = useState<string>('');
  const [policyAgreed, setPolicyAgreed] = useState(false);
  const [settings, setSettings] = useState<SalonSettings | null>(null);
  const [promos, setPromos] = useState<MonthlyPromo[]>([]);
  const [promoLoading, setPromoLoading] = useState(true);
  const [selectedPromoId, setSelectedPromoId] = useState<string | null>(null);
  
  // --- Data ---
  const [styles, setStyles] = useState<Style[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  
  // --- Step 1: Selection State ---
  const [selectedStyleId, setSelectedStyleId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(''); // Variation
  const [selectedStylistId, setSelectedStylistId] = useState<string>('');

  // --- Step 2: Time State ---
  const [weeklyAvailability, setWeeklyAvailability] = useState<Record<string, TimeSlot[]>>({});
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(startOfDay(new Date()));
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  // --- Step 3: Details State ---
  const [guestDetails, setGuestDetails] = useState<GuestDetails & { smsConsent: boolean }>({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    smsConsent: false
  });

  // --- Step 4: Payment State ---
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [authSmsConsent, setAuthSmsConsent] = useState(true);
  const [showAuthConsentDialog, setShowAuthConsentDialog] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [storedPaymentIntentId, setStoredPaymentIntentId] = useState<string | null>(null);

  // --- Computed ---
  const depositAmount = settings?.depositAmount
    ? typeof settings.depositAmount === 'string'
      ? parseFloat(settings.depositAmount)
      : settings.depositAmount
    : 50;

  const STRIPE_FEE_PERCENTAGE = 0.035;
  const rawProcessingFee = depositAmount * STRIPE_FEE_PERCENTAGE;
  const PROCESSING_FEE = Math.round(rawProcessingFee * 100) / 100;
  const TOTAL_DEPOSIT = depositAmount + PROCESSING_FEE;
  const TOTAL_DEPOSIT_CENTS = Math.round(TOTAL_DEPOSIT * 100);
  const availableVariations = useMemo(() => {
    if (!selectedStyleId) return [];
    const style = styles.find(s => s.id === selectedStyleId);
    return style?.pricing?.map(p => ({
        id: p.categoryId,
        name: p.category.name,
        price: p.price,
        duration: p.durationMinutes
    })) || [];
  }, [styles, selectedStyleId]);

  const selectedStylist = useMemo(() => 
    stylists.find(s => s.id === selectedStylistId),
    [stylists, selectedStylistId]
  );

  const stylistSurcharge = useMemo(() => {
    if (!selectedStylist || selectedStylistId === 'unassigned') return 0;

    // Strict restriction: Surcharge only applies to Victoria
    if (!selectedStylist.fullName.toLowerCase().includes('victoria')) return 0;

    // Check for style-specific surcharge
    if (selectedStyleId && (selectedStylist as any).styleSurcharges) {
        const styleSurcharges = (selectedStylist as any).styleSurcharges;
        if (styleSurcharges[selectedStyleId] !== undefined) {
             const s = styleSurcharges[selectedStyleId];
             const amount = typeof s === 'string' ? parseFloat(s) : Number(s || 0);
             return isNaN(amount) ? 0 : amount;
        }
    }

    const s: any = (selectedStylist as any).surcharge;
    const amount = typeof s === 'string' ? parseFloat(s) : Number(s || 0);
    return isNaN(amount) ? 0 : amount;
  }, [selectedStylist, selectedStylistId, selectedStyleId]);

  const selectedPricing = useMemo(() => {
    if (!selectedStyleId || !selectedCategoryId) return null;
    const style = styles.find(s => s.id === selectedStyleId);
    return style?.pricing?.find(p => p.categoryId === selectedCategoryId);
  }, [styles, selectedStyleId, selectedCategoryId]);

  const adjustedBasePrice = useMemo(() => {
    if (!selectedPricing) return 0;
    return Number(selectedPricing.price) + stylistSurcharge;
  }, [selectedPricing, stylistSurcharge]);

  const activePromo = useMemo(() => {
    if (!selectedPromoId) return null;
    return promos.find(p => p.id === selectedPromoId) || null;
  }, [promos, selectedPromoId]);

  const appliedDiscountPercentage = useMemo(() => {
    if (!activePromo) return 0;
    if (!selectedStyleId) return 0;
    if (!activePromo.stylePricing?.style?.id) return 0;
    if (activePromo.stylePricing.style.id !== selectedStyleId) return 0;
    return Number(activePromo.discountPercentage) || 0;
  }, [activePromo, selectedStyleId]);

  const discountedPrice = useMemo(() => {
    if (!selectedPricing) return null;
    if (!appliedDiscountPercentage) return adjustedBasePrice;
    const discountFactor = 1 - appliedDiscountPercentage / 100;
    const price = adjustedBasePrice * discountFactor;
    return Math.round(price * 100) / 100;
  }, [selectedPricing, appliedDiscountPercentage, adjustedBasePrice]);

  const effectivePromoPrice = useMemo(() => {
    if (!activePromo) return null;
    if (!selectedStyleId || !selectedPricing) return null;
    if (!activePromo.stylePricing?.style?.id) return null;
    if (activePromo.stylePricing.style.id !== selectedStyleId) return null;

    if (appliedDiscountPercentage > 0 && discountedPrice !== null) {
      return discountedPrice;
    }

    // Check for fixed promo price (handle string or number)
    const price = Number(activePromo.promoPrice);
    if (!isNaN(price) && price > 0) {
      return price + stylistSurcharge;
    }

    return null;
  }, [activePromo, selectedStyleId, selectedPricing, appliedDiscountPercentage, discountedPrice, stylistSurcharge]);

  // --- Initialization ---
  useEffect(() => {
    const loadData = async () => {
      try {
        const [stylesData, stylistsResponse, policy, settingsData] = await Promise.all([
          styleService.getAllStyles({ limit: 1000 }),
          stylistService.getAllStylists({ limit: 100 }),
          bookingPolicyService.getPolicy(),
          settingsService.getPublicSettings()
        ]);

        setStyles(stylesData.data);
        
        if (stylistsResponse && Array.isArray(stylistsResponse.data)) {
            setStylists(stylistsResponse.data);
        } else if (Array.isArray(stylistsResponse)) {
            setStylists(stylistsResponse);
        }

        if (policy) {
          setPolicyContent(policy.content);
        }

        if (settingsData) {
          setSettings(settingsData);
        }
      } catch (error) {
        console.error('Error loading data:', error);
        toast({
          title: "Error",
          description: "Failed to load booking data",
          variant: "destructive",
        });
      } finally {
        setInitialLoading(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    const loadPromos = async () => {
      try {
        const data = await getActivePromos();
        if (Array.isArray(data)) {
          setPromos(data);
        } else {
          setPromos([]);
        }
      } catch (error) {
        setPromos([]);
      } finally {
        setPromoLoading(false);
      }
    };
    loadPromos();
  }, []);

  useEffect(() => {
    if (!promos.length) return;

    let initialPromoId: string | null = null;

    try {
      const params = new URLSearchParams(location.search);
      initialPromoId = params.get('promoId');
    } catch (error) {
      console.error(error);
    }

    if (!initialPromoId) {
      try {
        initialPromoId = localStorage.getItem('selectedPromoId');
      } catch (error) {
        initialPromoId = null;
      }
    }

    if (initialPromoId && promos.some(p => p.id === initialPromoId)) {
      setSelectedPromoId(initialPromoId);
    }
  }, [promos, location.search]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const user = authService.getCurrentUser();
    if (user) {
      const initialConsent = user.notificationConsent ?? true;
      setAuthSmsConsent(initialConsent);
      setGuestDetails(prev => ({ 
        ...prev, 
        fullName: user.fullName || '',
        email: user.email || '',
        phone: user.phone || '',
        address: user.address || '',
        smsConsent: initialConsent 
      }));
    }
  }, [isLoggedIn]);

  // --- Fetch Availability (Step 3) ---
  useEffect(() => {
    if (step === 4 && selectedStyleId && selectedCategoryId && selectedDate) {
      const fetchAvailability = async () => {
        setLoading(true);
        try {
          const dateStr = format(selectedDate, 'yyyy-MM-dd');
          
          // Get duration from selected pricing
          const duration = selectedPricing?.durationMinutes || 60;

          const slots = await bookingService.getAvailability(
            dateStr,
            selectedStyleId,
            selectedCategoryId,
            (selectedStylistId && selectedStylistId !== 'unassigned') ? selectedStylistId : undefined,
            duration
          );
          setWeeklyAvailability({ [dateStr]: slots });
        } catch (error) {
          console.error(error);
          toast({
             title: "Error",
             description: "Failed to load availability",
             variant: "destructive"
          });
        } finally {
          setLoading(false);
        }
      };
      fetchAvailability();
    }
  }, [step, selectedDate, selectedStyleId, selectedCategoryId, selectedStylistId]);

  // --- Handlers ---

  const handleTimeSelect = (date: Date, time: string) => {
    setSelectedDate(date);
    setSelectedTime(time);
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!policyAgreed) {
        toast({ title: "Action Required", description: "Please agree to the booking policy.", variant: "destructive" });
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (activePromo?.stylePricing?.style?.id) {
        setSelectedStyleId(activePromo.stylePricing.style.id);
        
        // Preselect the variation (category) associated with the promo
        if (activePromo.stylePricing.category?.id) {
            setSelectedCategoryId(activePromo.stylePricing.category.id);
        } else {
            setSelectedCategoryId('');
        }
        
        setSelectedStylistId('');
      }
      setStep(3);
    } else if (step === 3) {
      if (!selectedStyleId || !selectedCategoryId) {
        toast({ title: "Incomplete Selection", description: "Please select a style and variation.", variant: "destructive" });
        return;
      }
      setStep(4);
    } else if (step === 4) {
      if (!selectedDate || !selectedTime) {
        toast({ title: "Select Time", description: "Please select a date and time.", variant: "destructive" });
        return;
      }
      
      const user = authService.getCurrentUser();
      if (isLoggedIn && user) {
          const consent = (user as any).notificationConsent ?? true;
        setGuestDetails({
            fullName: user.fullName,
            email: user.email,
            phone: user.phone || '',
            address: user.address || '',
            birthDay: user.birthDay?.toString(),
            birthMonth: user.birthMonth?.toString(),
            smsConsent: consent
        });
        setAuthSmsConsent(consent);
      }
      setStep(5);
    } else if (step === 5) {
      if (!guestDetails.fullName || !guestDetails.email || !guestDetails.phone) {
        toast({ title: "Required Fields", description: "Please fill in all details.", variant: "destructive" });
        return;
      }
      
      if (!isLoggedIn && !guestDetails.smsConsent) {
        setShowConsentDialog(true);
        return;
      }
      if (!selectedStyleId || !selectedCategoryId || !selectedDate || !selectedTime) {
        toast({ title: "Missing data", description: "Please complete previous steps.", variant: "destructive" });
        return;
      }
      if (!bookingId) {
        try {
          setLoading(true);
          const dateStr = format(selectedDate, 'yyyy-MM-dd');
          const booking = await bookingService.createBooking({
            styleId: selectedStyleId,
            categoryId: selectedCategoryId,
            stylistId: (selectedStylistId && selectedStylistId !== 'unassigned') ? selectedStylistId : undefined,
            date: dateStr,
            time: selectedTime,
            guestDetails: isLoggedIn ? { ...guestDetails, smsConsent: authSmsConsent } : guestDetails,
            promoId: activePromo ? activePromo.id : undefined,
          });
          setBookingId(booking.id);
        } catch (error: any) {
          toast({
            title: "Booking Failed",
            description: error.message || "Could not create booking",
            variant: "destructive",
          });
          return;
        } finally {
          setLoading(false);
        }
      }

      setStep(6);
    }
  };

  const handleBack = () => {
    if (step === 6) {
        setClientSecret(null);
        setStoredPaymentIntentId(null);
    }
    if (step > 1) {
        setStep(step - 1);
    }
  };
  
  const handlePaymentSuccess = async (paymentIntentId: string) => {
    if (!bookingId) return;
    
    setLoading(true);
    try {
      await bookingService.addPayment(bookingId, {
        amount: TOTAL_DEPOSIT,
        method: 'stripe',
        stripePaymentId: paymentIntentId
      });

      setStep(7);
    } catch (error: any) {
      toast({
        title: "Booking Failed",
        description: error.message || "Could not complete booking",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const initializePayment = useCallback(async () => {
    setLoading(true);
    setPaymentError(null);
    try {
      if (!bookingId) {
        throw new Error("No booking created for payment");
      }
      const data = await bookingService.createBookingPaymentIntent(bookingId, TOTAL_DEPOSIT_CENTS);
      if (!data.clientSecret || !data.paymentIntentId) {
        throw new Error("Invalid payment intent response");
      }
      setClientSecret(data.clientSecret);
      setStoredPaymentIntentId(data.paymentIntentId);
    } catch (error: any) {
      console.error("Payment initialization failed:", error);
      setPaymentError(error.message || "Failed to initialize payment");
      toast({ title: "Error", description: "Failed to initialize payment", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, TOTAL_DEPOSIT_CENTS, bookingId]);

  useEffect(() => {
    if (step === 6 && !clientSecret) {
      initializePayment();
    }
  }, [step, clientSecret, initializePayment]);

  const handlePaymentFailure = async (errorMessage: string) => {
    console.error("Payment failed:", errorMessage);
    if (!bookingId) {
        console.warn("No bookingId to cancel");
        return;
    }
    
    try {
        setLoading(true);
        // Cancel the booking on payment failure as requested
        const user = authService.getCurrentUser();
        const email = user ? undefined : guestDetails.email;
        console.log(`Cancelling booking ${bookingId} for email ${email || 'user'}`);
        
        await bookingService.cancelBooking(bookingId, email);
        console.log("Booking cancelled successfully");
        
        // Clear current booking state so user can start over or retry
        setBookingId(null);
        setClientSecret(null);
        setStoredPaymentIntentId(null);
        
        // Go back to details step
        setStep(5);
        
        toast({
            title: "Booking Cancelled",
            description: "Payment failed. Please review your details and try again.",
            variant: "destructive"
        });
    } catch (error) {
        console.error("Failed to cancel booking after payment failure:", error);
        // Even if cancellation fails, we should probably reset UI so user can retry
        // But maybe we should warn them?
        toast({
            title: "Error",
            description: "Payment failed and we couldn't cancel the pending booking. Please contact support.",
            variant: "destructive"
        });
    } finally {
        setLoading(false);
    }
  };

  const formatTimeDisplay = (time: string | null) => {
    if (!time) return '';
    try {
      const [hours, minutes] = time.split(':').map(Number);
      const date = new Date();
      date.setHours(hours, minutes);
      return format(date, 'h:mm a');
    } catch (e) {
      return time;
    }
  };

  const renderProgressBar = () => {
    const steps = [
        { num: 1, label: "Policy" },
        { num: 2, label: "Promos" },
        { num: 3, label: "Service" },
        { num: 4, label: "Time" },
        { num: 5, label: "Details" },
        { num: 6, label: "Payment" },
        { num: 7, label: "Done" }
    ];

    return (
        <div className="w-full bg-card border-b border-border mb-8 sticky top-0 z-10">
            <div className="container mx-auto px-4 py-4">
                <div className="flex justify-between items-center max-w-4xl mx-auto">
                    {steps.map((s) => {
                        const isActive = step === s.num;
                        const isCompleted = step > s.num;
                        return (
                            <div key={s.num} className="flex flex-col items-center relative group">
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors duration-200 z-10 border-2",
                                    isActive ? "bg-primary text-primary-foreground border-primary" : 
                                    isCompleted ? "bg-primary text-primary-foreground border-primary" : 
                                    "bg-background text-muted-foreground border-muted-foreground"
                                )}>
                                    {isCompleted ? <Check className="w-4 h-4" /> : s.num}
                                </div>
                                <span className={cn(
                                    "text-xs mt-2 font-medium transition-colors duration-200",
                                    isActive || isCompleted ? "text-primary" : "text-muted-foreground"
                                )}>
                                    {s.label}
                                </span>
                                {s.num < steps.length && (
                                    <div className={cn(
                                        "absolute top-4 left-1/2 w-full h-[2px] -z-0",
                                        isCompleted ? "bg-primary" : "bg-muted"
                                    )} style={{ width: "calc(100% + 2rem)" }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
  };

  const renderStep1 = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Card className="max-w-3xl mx-auto">
            <CardContent className="p-6 md:p-8 space-y-6">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                    <h2 className="text-2xl font-bold mb-4 text-center">Appointment Guidelines & Booking Promise</h2>
                    <div className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                        {initialLoading ? (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                                <span>Loading policy...</span>
                            </div>
                        ) : (
                            policyContent || "No policy content available."
                        )}
                    </div>
                </div>
                
                <div className="flex items-center space-x-2 pt-4 border-t">
                    <Checkbox 
                        id="policy-agreement" 
                        checked={policyAgreed} 
                        onCheckedChange={(checked) => setPolicyAgreed(checked as boolean)}
                        disabled={initialLoading}
                    />
                    <label
                        htmlFor="policy-agreement"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                        I have read and agree to the booking policy and guidelines.
                    </label>
                </div>
            </CardContent>
        </Card>
    </div>
  );

  const renderPromoStep = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="max-w-4xl mx-auto">
        <CardContent className="p-6 md:p-8 space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold">Monthly Promotions</h2>
            <p className="text-muted-foreground text-sm md:text-base">
              Choose a promotion to apply, or continue without one.
            </p>
          </div>
          {promoLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
              <span className="text-sm text-muted-foreground">Loading promotions...</span>
            </div>
          ) : promos.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              There are no active promotions at this time.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {promos.map((promo) => {
                  const isSelected = selectedPromoId === promo.id;
                  return (
                    <button
                      key={promo.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedPromoId(null);
                          try {
                            localStorage.removeItem('selectedPromoId');
                          } catch (error) {
                            console.error(error);
                          }
                        } else {
                          setSelectedPromoId(promo.id);
                          try {
                            localStorage.setItem('selectedPromoId', promo.id);
                          } catch (error) {
                            console.error(error);
                          }
                        }
                      }}
                      className={cn(
                        "text-left rounded-lg border transition-all",
                        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-gold/40 bg-card/90 hover:border-primary/60"
                      )}
                    >
                      <Card className="border-0 shadow-none bg-transparent">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.2em] text-primary">
                                {promo.promoMonth} {promo.promoYear}
                              </p>
                              <h3 className="text-lg font-semibold">
                                {promo.title || "Special Offer"}
                              </h3>
                              <p className="text-sm text-muted-foreground mt-1">
                                {promo.stylePricing?.style.name} •{" "}
                                {promo.stylePricing?.category.name}
                              </p>
                            </div>
                            <div className="text-right">
                              {typeof promo.discountPercentage === "number" ? (
                                <>
                                  <p className="text-xs text-muted-foreground">
                                    Discount
                                  </p>
                                  <p className="text-xl font-bold">
                                    {promo.discountPercentage}% off
                                  </p>
                                  <p className="text-[11px] text-muted-foreground mt-1">
                                    Applies to any {promo.stylePricing?.style.name} variation
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="text-xs text-muted-foreground">
                                    Promo price
                                  </p>
                                  <p className="text-xl font-bold">
                                    ${promo.promoPrice}
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                          {promo.description && (
                            <p className="text-sm">{promo.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground flex justify-between items-center">
                            <span>
                              Offer ends{" "}
                              {new Date(promo.offerEnds).toLocaleDateString(
                                undefined,
                                {
                                  month: "long",
                                  day: "numeric",
                                  year: "numeric",
                                }
                              )}
                            </span>
                            {isSelected && (
                              <span className="text-primary font-medium">
                                Selected
                              </span>
                            )}
                          </p>
                        </CardContent>
                      </Card>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPromoId(null);
                  try {
                    localStorage.removeItem('selectedPromoId');
                  } catch (error) {
                    console.error(error);
                  }
                }}
                className={cn(
                  "w-full text-sm mt-2 px-4 py-3 rounded-md border",
                  selectedPromoId
                    ? "border-muted-foreground/40 text-muted-foreground hover:bg-muted/40"
                    : "border-dashed border-muted-foreground/40 text-muted-foreground cursor-default"
                )}
              >
                {selectedPromoId
                  ? "I don't want to use a promotion"
                  : "No promotion selected"}
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {settings?.courtesyNotice && (
        <Card className="border-l-4 border-l-gold bg-gold/5 shadow-sm">
            <CardContent className="p-6">
                <div className="whitespace-pre-wrap text-sm md:text-base text-foreground/90 font-medium leading-relaxed font-serif">
                    {settings.courtesyNotice}
                </div>
            </CardContent>
        </Card>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-lg font-semibold">Select Style</Label>
            <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
              <SelectTrigger className="h-12 text-lg">
                <SelectValue placeholder="Choose a style..." />
              </SelectTrigger>
              <SelectContent>
                {styles.map((style) => (
                  <SelectItem key={style.id} value={style.id}>
                    <div className="flex items-center gap-3">
                      {style.imageUrl ? (
                        <img 
                          src={style.imageUrl} 
                          alt={style.name} 
                          className="w-8 h-8 rounded-full object-cover" 
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs">
                          {style.name.charAt(0)}
                        </div>
                      )}
                      <span>{style.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedStyleId && (
            <div className="space-y-2 animate-in fade-in zoom-in-95 duration-300">
              <Label className="text-lg font-semibold">Select Variation</Label>
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                <SelectTrigger className="h-12 text-lg">
                  <SelectValue placeholder="Choose variation..." />
                </SelectTrigger>
                <SelectContent>
                  {availableVariations.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} - ${v.price} ({v.duration} mins)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedCategoryId && (
            <div className="space-y-2 animate-in fade-in zoom-in-95 duration-300">
              <Label className="text-lg font-semibold">Select Braider</Label>
              <Select value={selectedStylistId} onValueChange={setSelectedStylistId}>
                <SelectTrigger className="h-12 text-lg">
                  <SelectValue placeholder="Any Available Braider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Any Available Braider</SelectItem>
                  {stylists
                    .filter(stylist => 
                      !selectedStyleId || 
                      (stylist.styles && stylist.styles.some(s => s.id === selectedStyleId))
                    )
                    .map((stylist) => (
                    <SelectItem key={stylist.id} value={stylist.id}>
                      {stylist.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Booking Summary</h3>
              {selectedPricing ? (
                 <div className="space-y-3">
                    {styles.find(s => s.id === selectedStyleId)?.imageUrl && (
                      <div className="mb-4 rounded-lg bg-muted flex items-center justify-center max-h-64 mx-auto border border-border">
                        <img
                          src={styles.find(s => s.id === selectedStyleId)?.imageUrl || ''}
                          alt="Selected Style"
                          className="max-h-64 w-auto object-contain"
                        />
                      </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Style:</span>
                        <span className="font-medium">{styles.find(s => s.id === selectedStyleId)?.name}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Variation:</span>
                        <span className="font-medium">{availableVariations.find(v => v.id === selectedCategoryId)?.name}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Braider:</span>
                        <span className="font-medium">
                            {stylists.find(s => s.id === selectedStylistId)?.fullName || (selectedStylistId === 'unassigned' ? "Any Available Braider" : "Not selected")}
                        </span>
                    </div>
                    <div className="border-t pt-3 mt-3 space-y-1">
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Base price:</span>
                        <span>${selectedPricing.price}</span>
                      </div>
                      {stylistSurcharge > 0 && (
                        <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Stylist surcharge ({stylists.find(s => s.id === selectedStylistId)?.fullName || 'Selected stylist'}):</span>
                            <span>+${stylistSurcharge}</span>
                        </div>
                      )}
                      
                      {appliedDiscountPercentage > 0 && discountedPrice !== null && (
                        <>
                          <div className="flex justify-between text-sm text-emerald-700">
                            <span>Promo discount ({appliedDiscountPercentage}%):</span>
                            <span>- ${(adjustedBasePrice - discountedPrice).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-base font-semibold">
                            <span>Promo price:</span>
                            <span>${discountedPrice.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      {appliedDiscountPercentage === 0 && effectivePromoPrice !== null && (
                        <>
                          <div className="flex justify-between text-sm text-emerald-700">
                            <span>Promo price for this offer:</span>
                            <span>${effectivePromoPrice.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>You save</span>
                            <span>${(adjustedBasePrice - effectivePromoPrice).toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      {appliedDiscountPercentage === 0 && effectivePromoPrice === null && stylistSurcharge > 0 && (
                        <div className="flex justify-between text-base font-semibold">
                            <span>Total price:</span>
                            <span>${adjustedBasePrice}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Duration:</span>
                        <span>{selectedPricing.durationMinutes} mins</span>
                      </div>
                    </div>
                     <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mt-4 text-sm text-yellow-800">
                        <p className="font-bold">Deposit Required: ${TOTAL_DEPOSIT.toFixed(2)} (Includes 3.5% fee)</p>
                        {/* <p className="mt-1 text-red-600 font-bold">This deposit secures your appointment. Note: A 3.5% transaction fee is applied to the deposit. The remaining service cost will be charged in store after the service is completed.</p> */}
                    </div>
                 </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                    Select a style and variation to see pricing.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
      <div className="flex flex-col md:flex-row gap-6">
         {/* Calendar Column */}
         <div className="w-full md:w-auto flex-shrink-0">
             <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                    if (date) {
                        setSelectedDate(date);
                        setSelectedTime(null);
                    }
                }}
                className="rounded-md border shadow-sm mx-auto bg-card"
                disabled={(date) => date < startOfDay(new Date())}
             />
         </div>
         
         {/* Time Slots Column */}
         <div className="flex-1 min-w-0">
            {selectedDate ? (
                <>
                    <div className="mb-4">
                         <h3 className="font-semibold text-lg">
                            Availability for {format(selectedDate, 'MMMM d, yyyy')}
                         </h3>
                    </div>

                    {loading ? (
                        <div className="h-64 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                            {(() => {
                                const dateStr = format(selectedDate, 'yyyy-MM-dd');
                                const rawSlots = weeklyAvailability[dateStr] || [];
                                
                                // Filter out past time slots if the date is today
                                const now = new Date();
                                const isToday = isSameDay(selectedDate, now);
                                const slots = rawSlots.filter(slot => {
                                    if (!isToday) return true;
                                    
                                    const [hours, minutes] = slot.time.split(':').map(Number);
                                    const slotTime = new Date(selectedDate);
                                    slotTime.setHours(hours, minutes, 0, 0);
                                    
                                    return slotTime > now;
                                });

                                if (slots.length === 0) {
                                    return (
                                        <div className="col-span-full text-center text-muted-foreground py-8 border rounded-md border-dashed">
                                            No available slots for this date for the selected stylist.
                                        </div>
                                    );
                                }

                                return slots.map((slot) => (
                                    <Button
                                        key={`${dateStr}-${slot.time}`}
                                        variant={selectedTime === slot.time ? "default" : "outline"}
                                        className={cn(
                                            "w-full h-10",
                                            !slot.available && "opacity-50 cursor-not-allowed bg-muted"
                                        )}
                                        disabled={!slot.available}
                                        onClick={() => handleTimeSelect(selectedDate, slot.time)}
                                    >
                                        {formatTimeDisplay(slot.time)}
                                    </Button>
                                ));
                            })()}
                        </div>
                    )}
                </>
            ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground border rounded-md border-dashed p-12">
                    Select a date to view availability
                </div>
            )}
         </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">
        <div className="grid gap-4">
            <div className="grid gap-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input 
                    id="fullName" 
                    value={guestDetails.fullName} 
                    onChange={(e) => setGuestDetails({...guestDetails, fullName: e.target.value})}
                    placeholder="Jane Doe"
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                    id="email" 
                    type="email"
                    value={guestDetails.email} 
                    onChange={(e) => setGuestDetails({...guestDetails, email: e.target.value})}
                    placeholder="jane@example.com"
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input 
                    id="phone" 
                    type="tel"
                    value={guestDetails.phone} 
                    onChange={(e) => setGuestDetails({...guestDetails, phone: e.target.value})}
                    placeholder="(555) 123-4567"
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="address">Address (Optional)</Label>
                <Input 
                    id="address" 
                    value={guestDetails.address} 
                    onChange={(e) => setGuestDetails({...guestDetails, address: e.target.value})}
                    placeholder="123 Main St"
                />
            </div>

            {!isLoggedIn && (
               <div className="flex items-center space-x-2 mt-2">
                  <Checkbox 
                      id="smsConsent" 
                      checked={guestDetails.smsConsent}
                      onCheckedChange={(checked) => setGuestDetails({...guestDetails, smsConsent: checked as boolean})}
                  />
                  <Label htmlFor="smsConsent" className="text-sm font-normal cursor-pointer">
                      I consent to receiving SMS and email notifications
                  </Label>
               </div>
            )}

            {isLoggedIn && (
               <div className="flex items-center space-x-2 mt-2">
                  <Checkbox
                      id="authSmsConsentStep3"
                      checked={authSmsConsent}
                      onCheckedChange={(checked) => {
                          const next = checked as boolean;
                          if (!next && authSmsConsent) {
                              setShowAuthConsentDialog(true);
                              return;
                          }
                          setAuthSmsConsent(next);
                          setGuestDetails(prev => ({ ...prev, smsConsent: next }));
                          userService.updateNotificationConsent(next).catch(() => {});
                          authService.getMe().catch(() => {});
                      }}
                  />
                  <Label htmlFor="authSmsConsentStep3" className="text-sm font-normal cursor-pointer">
                     I consent to receiving SMS and email notifications
                  </Label>
               </div>
            )}

             {!isLoggedIn && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label>Birthday (Optional)</Label>
                        <Select onValueChange={(v) => setGuestDetails({...guestDetails, birthMonth: v})}>
                            <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                            <SelectContent>
                                {Array.from({length: 12}, (_, i) => i + 1).map(m => (
                                    <SelectItem key={m} value={m.toString()}>{format(new Date(2000, m-1, 1), 'MMMM')}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                     <div className="grid gap-2">
                        <Label>&nbsp;</Label>
                        <Select onValueChange={(v) => setGuestDetails({...guestDetails, birthDay: v})}>
                            <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
                            <SelectContent>
                                {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                                    <SelectItem key={d} value={d.toString()}>{d}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}
        </div>
    </div>
  );

  const renderStep5 = () => (
      <div className="max-w-md mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <Card>
              <CardContent className="p-6">
                  <h3 className="text-xl font-bold mb-4">Confirm & Pay Deposit</h3>
                  <div className="space-y-4 mb-6">
                      <div className="flex justify-between py-2 border-b">
                          <span className="text-muted-foreground">Service</span>
                          <span className="font-medium">
                            {styles.find(s => s.id === selectedStyleId)?.name} - {availableVariations.find(v => v.id === selectedCategoryId)?.name}
                          </span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                          <span className="text-muted-foreground">Date & Time</span>
                          <span className="font-medium">
                              {selectedDate && format(selectedDate, 'MMM d, yyyy')} at {formatTimeDisplay(selectedTime)}
                          </span>
                      </div>
                      {selectedPricing && (
                        <div className="space-y-1 py-2 border-b">
                          <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Base price</span>
                            <span>${selectedPricing.price}</span>
                          </div>
                          {stylistSurcharge > 0 && (
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Master Stylist Surcharge (Victoria)</span>
                                <span>+${stylistSurcharge}</span>
                            </div>
                          )}
                          {appliedDiscountPercentage > 0 && discountedPrice !== null && (
                            <>
                              <div className="flex justify-between text-sm text-emerald-700">
                                <span>Promo discount ({appliedDiscountPercentage}%)</span>
                                <span>- ${(adjustedBasePrice - discountedPrice).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-base font-semibold">
                                <span>Promo price</span>
                                <span>${discountedPrice.toFixed(2)}</span>
                              </div>
                            </>
                          )}
                          {appliedDiscountPercentage === 0 && effectivePromoPrice !== null && (
                            <div className="flex justify-between text-base font-semibold">
                              <span>Promo price</span>
                              <span>${effectivePromoPrice.toFixed(2)}</span>
                            </div>
                          )}
                          {appliedDiscountPercentage === 0 && effectivePromoPrice === null && (
                            <div className="flex justify-between text-base font-semibold">
                              <span>Total price</span>
                              <span>${adjustedBasePrice}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex justify-between py-2 text-sm">
                          <span className="text-muted-foreground">Booking Deposit</span>
                          <span className="font-medium">${depositAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 text-sm border-b">
                          <span className="text-muted-foreground">Processing Fee (3.5%)</span>
                          <span className="font-medium">${PROCESSING_FEE.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 text-lg font-bold">
                          <span>Deposit Due Now</span>
                          <span>${TOTAL_DEPOSIT.toFixed(2)}</span>
                   </div>
                  </div>

                  {clientSecret && (
                      <Elements stripe={stripePromise} options={{ clientSecret }}>
                          <CheckoutForm onSuccess={handlePaymentSuccess} onFailure={handlePaymentFailure} amount={TOTAL_DEPOSIT_CENTS} />
                      </Elements>
                  )}
                  {!clientSecret && (
                     <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                        <p className="text-muted-foreground">Preparing secure checkout...</p>
                     </div>
                  )}
                  
                  {paymentError && (
                      <div className="text-destructive text-sm mt-4 text-center">
                          {paymentError}
                          <Button variant="link" onClick={initializePayment} className="pl-1">Retry</Button>
                      </div>
                  )}
              </CardContent>
          </Card>
      </div>
  );

  const renderStep6 = () => (
      <div className="max-w-md mx-auto text-center space-y-6 py-12 animate-in fade-in zoom-in-95 duration-500">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-bold">Booking Confirmed!</h2>
          <div className="text-muted-foreground space-y-2">
              <p>
                  Thank you for booking with {SALON_INFO.name}. A confirmation email has been sent to you.
              </p>
              <p>
                  To change your booking, text {SALON_INFO.bookingPhone}.
              </p>
              <p>
                  For other enquiries, call {SALON_INFO.inquiryPhone}.
              </p>
          </div>
          <div className="pt-6">
              <Button onClick={() => navigate('/')} className="w-full">
                  Return to Home
              </Button>
          </div>
      </div>
  );

  return (
    <div className="min-h-screen bg-background pb-20">
      {renderProgressBar()}
      
      <div className="container mx-auto px-4">
        {step === 1 && renderStep1()}
        {step === 2 && renderPromoStep()}
        {step === 3 && renderStep2()}
        {step === 4 && renderStep3()}
        {step === 5 && renderStep4()}
        {step === 6 && renderStep5()}
        {step === 7 && renderStep6()}

        {step < 7 && (
            <div className="max-w-4xl mx-auto mt-8 flex justify-between">
                <Button 
                    variant="outline" 
                    onClick={handleBack}
                    disabled={step === 1 || loading}
                    className={step === 1 ? "invisible" : ""}
                >
                    Back
                </Button>
                
                {step < 6 && (
                    <Button 
                        onClick={handleNext} 
                        disabled={loading}
                        className={step === 1 && !policyAgreed ? "hidden" : ""}
                    >
                        {step === 1 ? "Book Now" : "Next Step"}
                    </Button>
                )}
            </div>
        )}
      </div>

      <AlertDialog open={showConsentDialog} onOpenChange={setShowConsentDialog}>
        <AlertDialogContent className="max-h-[90vh] w-[95vw] sm:max-w-lg flex flex-col">
          <div className="flex-1 overflow-y-auto px-1">
            <AlertDialogHeader>
              <AlertDialogTitle>Stay in the loop?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you don't want to receive notifications from {SALON_INFO.name} for updates and bonuses?
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
                setShowConsentDialog(false);
                setStep(5);
            }}>No, thanks</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
                setGuestDetails(prev => ({...prev, smsConsent: true}));
                setShowConsentDialog(false);
                setStep(5);
            }}>Yes, I want updates</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showAuthConsentDialog} onOpenChange={setShowAuthConsentDialog}>
        <AlertDialogContent className="max-h-[90vh] w-[95vw] sm:max-w-lg flex flex-col">
          <div className="flex-1 overflow-y-auto px-1">
            <AlertDialogHeader>
              <AlertDialogTitle>Stay in the loop?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you don't want to receive notifications from {SALON_INFO.name} for updates and bonuses?
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setAuthSmsConsent(false);
              setGuestDetails(prev => ({ ...prev, smsConsent: false }));
              setShowAuthConsentDialog(false);
              userService.updateNotificationConsent(false).catch(() => {});
              authService.getMe().catch(() => {});
            }}>No, thanks</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setAuthSmsConsent(true);
              setGuestDetails(prev => ({ ...prev, smsConsent: true }));
              setShowAuthConsentDialog(false);
              userService.updateNotificationConsent(true).catch(() => {});
              authService.getMe().catch(() => {});
            }}>Yes, I want updates</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
