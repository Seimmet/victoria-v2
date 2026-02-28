import { authService } from './authService';
import { API_BASE_URL } from '../config';

const API_URL = API_BASE_URL;

export interface TimeSlot {
  time: string;
  available: boolean;
  spots: number;
}

export interface GuestDetails {
    fullName: string;
    email: string;
    phone: string;
    address?: string;
    birthDay?: string;
    birthMonth?: string;
    smsConsent?: boolean;
}

export interface CreateBookingData {
  styleId: string;
  categoryId: string;
  stylistId?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  guestDetails?: GuestDetails;
  paymentIntentId?: string;
  promoId?: string | null;
}

export interface Payment {
  id: string;
  amount: number;
  status: string;
  stripePaymentId?: string;
  createdAt: string;
}

export interface Booking {
  id: string;
  date: string;
  time: string;
  status: string;
  customer: {
    fullName: string;
    email: string;
    phone: string;
  };
  style: {
    name: string;
  };
  category: {
    name: string;
  };
  price: number;
  stylist?: {
    id: string;
    user: {
      fullName: string;
    };
  };
  stylistId?: string | null;
  categoryId?: string;
  duration?: number;
  bookingDate: string;
  bookingTime: string;
  payments: Payment[];
  totalPaid?: number;
  paymentStatus?: 'pending' | 'deposit_paid' | 'paid_in_full';
  promo?: {
    id: string;
    title?: string;
    promoMonth: string;
    promoYear: number;
    discountPercentage?: number;
    promoPrice: number;
    stylePricing?: {
      style: { name: string };
      category: { name: string };
    };
  } | null;
}

export const bookingService = {
  async getAvailability(date: string, styleId?: string, categoryId?: string, stylistId?: string, duration?: number, excludeBookingId?: string, signal?: AbortSignal): Promise<TimeSlot[]> {
    const params = new URLSearchParams({ date, _t: Date.now().toString() });
    if (styleId) params.append('styleId', styleId);
    if (categoryId) params.append('categoryId', categoryId);
    if (stylistId) params.append('stylistId', stylistId);
    if (duration) params.append('duration', duration.toString());
    if (excludeBookingId) params.append('excludeBookingId', excludeBookingId);
    
    const response = await fetch(`${API_URL}/availability?${params.toString()}`, { signal });
    if (!response.ok) throw new Error('Failed to fetch availability');
    return response.json();
  },

  async getWeeklyAvailability(startDate: string, endDate: string, styleId?: string, categoryId?: string, stylistId?: string, duration?: number): Promise<Record<string, TimeSlot[]>> {
    const params = new URLSearchParams({ startDate, endDate, _t: Date.now().toString() });
    if (styleId) params.append('styleId', styleId);
    if (categoryId) params.append('categoryId', categoryId);
    if (stylistId) params.append('stylistId', stylistId);
    if (duration) params.append('duration', duration.toString());
    
    const response = await fetch(`${API_URL}/availability?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch availability');
    return response.json();
  },

  async createBooking(data: CreateBookingData): Promise<any> {
     const token = authService.getToken();
     const headers: any = {
        'Content-Type': 'application/json',
     };
     
     // Only add Authorization if token exists
     if (token) {
        headers['Authorization'] = `Bearer ${token}`;
     }

     const response = await fetch(`${API_URL}/bookings`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
     });
     if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create booking');
     }
     return response.json();
  },

  async getBookings(): Promise<Booking[]> {
     const token = authService.getToken();
     const response = await fetch(`${API_URL}/bookings`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
     });
     if (!response.ok) throw new Error('Failed to fetch bookings');
     return response.json();
  },

  async createPaymentIntent(amount: number, guestDetails?: any): Promise<{ clientSecret: string, id: string }> {
      const token = authService.getToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_URL}/bookings/create-payment-intent`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ amount, guestDetails })
      });

      if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Failed to create payment intent' }));
          throw new Error(error.message || 'Failed to create payment intent');
      }
      return response.json();
  },


  async cancelBooking(id: string, email?: string): Promise<Booking> {
      const token = authService.getToken();
      const headers: any = {
          'Content-Type': 'application/json'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const body: any = { status: 'cancelled' };
      if (email) body.email = email;

      const response = await fetch(`${API_URL}/bookings/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body)
      });

      if (!response.ok) {
          let errorMsg = 'Failed to cancel booking';
          try {
            const error = await response.json();
            errorMsg = error.message || errorMsg;
          } catch (e) {
             // Response was not JSON
          }
          throw new Error(errorMsg);
      }
      
      try {
        return await response.json();
      } catch (e) {
         // If response is empty or not JSON, return minimal booking object or throw
         return { id, status: 'cancelled' } as any;
      }
  },

  async updateBooking(id: string, data: { status?: string; stylistId?: string; paymentStatus?: string; date?: string; time?: string }): Promise<Booking> {
      const token = authService.getToken();
      const response = await fetch(`${API_URL}/bookings/${id}`, {
          method: 'PATCH',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(data)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update booking');
      }
      return response.json();
  },

  async checkInBooking(id: string): Promise<Booking> {
      const token = authService.getToken();
      const response = await fetch(`${API_URL}/bookings/${id}/check-in`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
          }
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to check in');
      }
      return response.json();
  },

  async addPayment(bookingId: string, data: { amount: number; method: 'cash' | 'stripe'; stripePaymentId?: string }): Promise<Booking> {
    const token = authService.getToken();
    const response = await fetch(`${API_URL}/bookings/${bookingId}/payments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
         const error = await response.json();
         throw new Error(error.message || 'Failed to add payment');
    }
    return response.json();
  },

  async createBookingPaymentIntent(bookingId: string, amount: number): Promise<{ clientSecret: string; paymentIntentId: string }> {
      const token = authService.getToken();
      const response = await fetch(`${API_URL}/bookings/${bookingId}/payment-intent`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ amount })
      });
      if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create payment intent');
      }
      return response.json();
  }
};
