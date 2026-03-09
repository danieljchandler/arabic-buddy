import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription, SUBSCRIPTION_TIERS } from '@/hooks/useSubscription';
import { AppShell } from '@/components/layout/AppShell';
import { HomeButton } from '@/components/HomeButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, Crown, Sparkles, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const Pricing = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { subscribed, tier, loading: subLoading, createCheckout, openCustomerPortal } = useSubscription();

  const handleSubscribe = async (selectedTier: 'standard' | 'allin') => {
    if (!user) {
      navigate('/auth');
      return;
    }

    try {
      await createCheckout(selectedTier);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to start checkout. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleManageSubscription = async () => {
    try {
      await openCustomerPortal();
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to open subscription management. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const loading = authLoading || subLoading;

  return (
    <AppShell>
      <div className="mb-8">
        <HomeButton />
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-foreground mb-3 font-heading">
            Choose Your Plan
          </h1>
          <p className="text-muted-foreground text-lg">
            Unlock the full power of Lahja to accelerate your Arabic learning
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Current subscription banner */}
            {subscribed && tier && (
              <div className="mb-8 p-4 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Crown className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    You're on the <span className="text-primary">{SUBSCRIPTION_TIERS[tier].name}</span> plan
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={handleManageSubscription}>
                  <Settings className="h-4 w-4 mr-2" />
                  Manage
                </Button>
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-6">
              {/* Free tier */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-xl">Free</CardTitle>
                  <CardDescription>Get started with the basics</CardDescription>
                  <div className="mt-4">
                    <span className="text-3xl font-bold">$0</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {[
                      'Browse vocabulary topics',
                      'Basic flashcard review',
                      '10 vocabulary words',
                      'Limited Discover videos',
                    ].map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full" disabled>
                    Current Plan
                  </Button>
                </CardFooter>
              </Card>

              {/* Standard tier */}
              <Card className={`border-2 ${tier === 'standard' ? 'border-primary' : 'border-border'}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{SUBSCRIPTION_TIERS.standard.name}</CardTitle>
                    {tier === 'standard' && (
                      <Badge variant="default" className="bg-primary">Your Plan</Badge>
                    )}
                  </div>
                  <CardDescription>For serious learners</CardDescription>
                  <div className="mt-4">
                    <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.standard.price}</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {SUBSCRIPTION_TIERS.standard.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {tier === 'standard' ? (
                    <Button variant="outline" className="w-full" onClick={handleManageSubscription}>
                      Manage Subscription
                    </Button>
                  ) : (
                    <Button className="w-full" onClick={() => handleSubscribe('standard')}>
                      {user ? 'Subscribe' : 'Sign Up to Subscribe'}
                    </Button>
                  )}
                </CardFooter>
              </Card>

              {/* All-In tier */}
              <Card className={`border-2 ${tier === 'allin' ? 'border-primary' : 'border-accent'} relative`}>
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-accent text-accent-foreground">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Best Value
                  </Badge>
                </div>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{SUBSCRIPTION_TIERS.allin.name}</CardTitle>
                    {tier === 'allin' && (
                      <Badge variant="default" className="bg-primary">Your Plan</Badge>
                    )}
                  </div>
                  <CardDescription>Unlimited everything</CardDescription>
                  <div className="mt-4">
                    <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.allin.price}</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {SUBSCRIPTION_TIERS.allin.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {tier === 'allin' ? (
                    <Button variant="outline" className="w-full" onClick={handleManageSubscription}>
                      Manage Subscription
                    </Button>
                  ) : (
                    <Button className="w-full bg-accent hover:bg-accent/90" onClick={() => handleSubscribe('allin')}>
                      {user ? 'Subscribe' : 'Sign Up to Subscribe'}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-8">
              All plans include a 7-day money-back guarantee. Cancel anytime.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
};

export default Pricing;
