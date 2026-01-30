import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const GRADIENT_OPTIONS = [
  { value: 'from-yellow-400 to-orange-500', label: 'Sunny Yellow', preview: '🌞' },
  { value: 'from-orange-400 to-red-500', label: 'Coral Orange', preview: '🧡' },
  { value: 'from-green-400 to-emerald-600', label: 'Mint Green', preview: '💚' },
  { value: 'from-blue-400 to-cyan-500', label: 'Sky Blue', preview: '💙' },
  { value: 'from-purple-400 to-pink-500', label: 'Lavender', preview: '💜' },
  { value: 'from-pink-400 to-rose-500', label: 'Pink Rose', preview: '💗' },
  { value: 'from-teal-400 to-green-500', label: 'Teal', preview: '🩵' },
  { value: 'from-indigo-400 to-purple-500', label: 'Indigo', preview: '💎' },
];

const ICON_OPTIONS = ['🎨', '🐾', '🏠', '🔧', '🍎', '🌿', '📚', '⭐', '🎵', '🚗', '👕', '🔢', '✏️', '🎮'];

const TopicForm = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!topicId;

  const [name, setName] = useState('');
  const [nameArabic, setNameArabic] = useState('');
  const [icon, setIcon] = useState('📚');
  const [gradient, setGradient] = useState('from-yellow-400 to-orange-500');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Fetch existing topic if editing
  const { data: existingTopic, isLoading: loadingTopic } = useQuery({
    queryKey: ['topic', topicId],
    queryFn: async () => {
      if (!topicId) return null;
      const { data, error } = await supabase
        .from('topics')
        .select('*')
        .eq('id', topicId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: isEditing,
  });

  useEffect(() => {
    if (existingTopic) {
      setName(existingTopic.name);
      setNameArabic(existingTopic.name_arabic);
      setIcon(existingTopic.icon);
      setGradient(existingTopic.gradient);
    }
  }, [existingTopic]);

  // Track unsaved changes
  useEffect(() => {
    if (!existingTopic && (name || nameArabic || icon !== '📚' || gradient !== 'from-yellow-400 to-orange-500')) {
      setHasUnsavedChanges(true);
    } else if (existingTopic) {
      const changed = 
        name !== existingTopic.name ||
        nameArabic !== existingTopic.name_arabic ||
        icon !== existingTopic.icon ||
        gradient !== existingTopic.gradient;
      setHasUnsavedChanges(changed);
    }
  }, [name, nameArabic, icon, gradient, existingTopic]);

  const mutation = useMutation({
    mutationFn: async () => {
      // Check for duplicate names
      const { data: existing } = await supabase
        .from('topics')
        .select('id')
        .or(`name.eq.${n
