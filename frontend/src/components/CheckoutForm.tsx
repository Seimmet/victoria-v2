import React, { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Loader2 } from "lucide-react";
import { useToast } from '@/hooks/use-toast';

interface CheckoutFormProps {
  onSuccess: (paymentIntentId: string) => void;
  onFailure?: (error: string) => void;
  amount: number;
}

export default function CheckoutForm({ onSuccess, onFailure, amount }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // No redirect for now, handle in code if possible or use redirect
        // We use redirect: 'if_required' to handle success inline
        return_url: window.location.origin + '/booking/success', 
      },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMessage(error.message || 'Payment failed');
      toast({
        title: 'Payment Failed',
        description: error.message || 'Could not process payment',
        variant: 'destructive',
      });
      if (onFailure) {
          try {
            await onFailure(error.message || 'Payment failed');
          } catch (e) {
            console.error("onFailure callback failed", e);
          }
      }
      setLoading(false);
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      toast({
        title: 'Payment Successful',
        description: 'Your deposit has been processed.',
      });
      onSuccess(paymentIntent.id);
      // Don't stop loading here, wait for parent to proceed
    } else {
        // Unexpected state
        setLoading(false);
    }
  };

  return (
       <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto space-y-6">
      <div className="bg-white p-6 rounded-lg border shadow-sm">
        <h3 className="text-lg font-medium mb-4">Pay Deposit: ${(amount / 100).toFixed(2)}</h3>
        <PaymentElement />
        {errorMessage && <div className="text-red-500 text-sm mt-2">{errorMessage}</div>}
        <Button 
            type="submit" 
            disabled={!stripe || loading} 
            className="w-full mt-4"
        >
            {loading ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                </>
            ) : (
                `Pay $${(amount / 100).toFixed(2)} Booking Fee`
            )}
        </Button>
      </div>
      <p className="text-xs text-center text-muted-foreground">
        Secure payment powered by Stripe. Your deposit is non-refundable.
      </p>
    </form>
  );
}
