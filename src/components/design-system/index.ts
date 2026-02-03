/**
 * Lahja Design System Components
 * 
 * These are the official reusable UI components for the Lahja app.
 * Use these components consistently throughout the application.
 * Do NOT introduce new visual styles - extend these components instead.
 */

// Cards
export { TopicCard, type TopicCardTopic } from './TopicCard';
export { VocabularyCard, type VocabularyWord } from './VocabularyCard';

// Layout
export { SectionFrame } from './SectionFrame';
export { ArabicGeometricHeader } from './ArabicGeometricHeader';

// Typography
export { SectionHeader } from './SectionHeader';

// Re-export shadcn primitives with enforced styles
export { Button, buttonVariants } from '@/components/ui/button';
export { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
