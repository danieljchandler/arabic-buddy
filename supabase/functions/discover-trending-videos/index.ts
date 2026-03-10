const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY');

// All six Gulf Cooperation Council (GCC) countries
const GULF_REGIONS = [
  'SA', // Saudi Arabia
  'AE', // United Arab Emirates
  'KW', // Kuwait
  'QA', // Qatar
  'BH', // Bahrain
  'OM', // Oman
];

// YouTube category ID for Gaming — used as an additional signal
const GAMING_CATEGORY_ID = '20';

// Keywords that indicate Quran / religious recitation content to exclude
const QURAN_KEYWORDS = [
  // Arabic
  'قرآن', 'تلاوة', 'سورة', 'آية', 'حفص', 'ورش', 'ختمة', 'مصحف', 'تجويد',
  'القرآن', 'الكريم', 'رمضان كريم', 'ختم', 'حفظ القرآن', 'قارئ',
  // English
  'quran', 'quran recitation', 'recitation', 'tilawah', 'surah', 'ayah',
  'hafiz', 'tajweed', 'koran',
];

// Keywords that indicate gaming content to exclude
const GAMING_KEYWORDS = [
  // Arabic
  'ألعاب', 'لعبة', 'جيمنج', 'بلايستيشن', 'ببجي', 'فورت نايت', 'ماين كرافت',
  'جيمر', 'تحديات الألعاب', 'فري فاير', 'كلاش', 'ليغ أوف ليجيندز',
  // English
  'gaming', 'gameplay', 'gamer', 'game review', "let's play", 'playthrough',
  'fortnite', 'pubg', 'ps5', 'xbox', 'minecraft', 'free fire', 'cod', 'warzone',
  'roblox', 'valorant', 'league of legends', 'fifa', 'pes', 'steam',
];

interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    channelId: string;
    description: string;
    categoryId?: string;
    thumbnails: {
      high?: { url: string };
      medium?: { url: string };
      default?: { url: string };
    };
    publishedAt: string;
  };
  statistics?: {
    viewCount: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration: string;
  };
}

interface YouTubeResponse {
  items?: YouTubeVideo[];
  error?: { message: string; code: number };
}

interface RegionResult {
  region: string;
  candidates: VideoCandidate[];
  skipped: number;
}

interface VideoCandidate {
  video_id: string;
  platform: string;
  url: string;
  title: string;
  creator_name: string;
  creator_handle: string;
  thumbnail_url: string | null;
  view_count: number;
  trending_score: number;
  detected_topic: string;
  region_code: string;
  duration_seconds: number | null;
  discovered_at: string;
}

// Max videos to keep per Gulf country after filtering
const MAX_PER_REGION = 5;

// Duration limits: skip very short clips (Shorts/ads) and very long ones (full films)
const MIN_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 3600;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!YOUTUBE_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'YouTube API key not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('Starting discovery of trending Gulf Arabic videos...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase environment not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all regions in parallel — much faster than sequential and avoids timeout
    const regionSettled = await Promise.allSettled(
      GULF_REGIONS.map((region) => fetchRegion(region))
    );

    // Collect results, dedup video IDs across regions (first-region wins)
    const seenVideoIds = new Set<string>();
    const allCandidates: VideoCandidate[] = [];
    const regionSummary: Record<string, number> = {};

    for (const settled of regionSettled) {
      if (settled.status === 'rejected') {
        console.error('Region fetch failed:', settled.reason);
        continue;
      }

      const { region, candidates } = settled.value;

      // Take top candidates for this region, excluding cross-region duplicates
      let kept = 0;
      for (const candidate of candidates) {
        if (kept >= MAX_PER_REGION) break;
        if (seenVideoIds.has(candidate.video_id)) {
          console.log(`Skipping cross-region duplicate: ${candidate.title}`);
          continue;
        }
        seenVideoIds.add(candidate.video_id);
        allCandidates.push(candidate);
        kept++;
      }

      regionSummary[region] = kept;
      console.log(`Region ${region}: kept ${kept} videos`);
    }

    console.log(`Total Gulf Arabic candidates to save: ${allCandidates.length}`);

    if (allCandidates.length > 0) {
      const insertResponse = await fetch(`${supabaseUrl}/rest/v1/trending_video_candidates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(allCandidates),
      });

      if (!insertResponse.ok) {
        const errText = await insertResponse.text();
        console.error('Failed to save candidates:', errText);
        return new Response(
          JSON.stringify({ error: 'Failed to save video candidates', detail: errText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Successfully saved ${allCandidates.length} Gulf Arabic video candidates`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        candidates_found: allCandidates.length,
        regions_processed: GULF_REGIONS,
        region_summary: regionSummary,
        message: `Discovered ${allCandidates.length} trending Gulf Arabic videos (max ${MAX_PER_REGION} per country)`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error in discover-trending-videos:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function fetchRegion(region: string): Promise<RegionResult> {
  // hl=ar biases returned metadata toward Arabic — helps surface Gulf dialect content
  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,statistics,contentDetails` +
    `&chart=mostPopular` +
    `&regionCode=${region}` +
    `&hl=ar` +
    `&maxResults=25` +
    `&key=${YOUTUBE_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YouTube API ${response.status} for ${region}: ${text}`);
  }

  const data: YouTubeResponse = await response.json();

  if (data.error) {
    throw new Error(`YouTube API error for ${region}: ${data.error.message}`);
  }

  const items = data.items ?? [];
  const candidates: VideoCandidate[] = [];
  let skipped = 0;

  for (const video of items) {
    const title = video.snippet.title;
    const description = video.snippet.description ?? '';

    // Must have Arabic in title or description
    const hasArabicTitle = /[\u0600-\u06FF]/.test(title);
    const hasArabicDescription = /[\u0600-\u06FF]/.test(description);
    if (!hasArabicTitle && !hasArabicDescription) {
      skipped++;
      continue;
    }

    // Exclude Quran / religious recitation
    if (isQuranContent(title, description)) {
      skipped++;
      continue;
    }

    // Exclude gaming content
    if (isGamingContent(title, description, video.snippet.categoryId)) {
      skipped++;
      continue;
    }

    // Duration filter: skip Shorts (< 60s) and full films (> 60min)
    const durationSeconds = parseDuration(video.contentDetails?.duration);
    if (durationSeconds > 0 && (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS)) {
      skipped++;
      continue;
    }

    const viewCount = parseInt(video.statistics?.viewCount ?? '0', 10);
    const likeCount = parseInt(video.statistics?.likeCount ?? '0', 10);
    const commentCount = parseInt(video.statistics?.commentCount ?? '0', 10);

    // Trending score: 40% reach, 30% like-rate, 30% discussion
    const likeRatio = viewCount > 0 ? (likeCount / viewCount) * 100 : 0;
    const trendingScore = Math.floor(
      (viewCount / 10000) * 40 +
      likeRatio * 30 +
      (commentCount / 1000) * 30
    );

    if (trendingScore < 10) {
      skipped++;
      continue;
    }

    candidates.push({
      video_id: video.id,
      platform: 'youtube',
      url: `https://www.youtube.com/watch?v=${video.id}`,
      title,
      creator_name: video.snippet.channelTitle,
      creator_handle: video.snippet.channelId,
      thumbnail_url:
        video.snippet.thumbnails.high?.url ??
        video.snippet.thumbnails.medium?.url ??
        video.snippet.thumbnails.default?.url ??
        null,
      view_count: viewCount,
      trending_score: trendingScore,
      detected_topic: detectTopic(title, description),
      region_code: region,
      duration_seconds: durationSeconds > 0 ? durationSeconds : null,
      discovered_at: new Date().toISOString(),
    });
  }

  // Sort best first, caller will slice to MAX_PER_REGION after cross-region dedup
  candidates.sort((a, b) => b.trending_score - a.trending_score);

  console.log(`Region ${region}: ${candidates.length} passed filters, ${skipped} skipped`);
  return { region, candidates, skipped };
}

function isQuranContent(title: string, description: string): boolean {
  const text = (title + ' ' + description).toLowerCase();
  return QURAN_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

function isGamingContent(title: string, description: string, categoryId?: string): boolean {
  if (categoryId === GAMING_CATEGORY_ID) return true;
  const text = (title + ' ' + description).toLowerCase();
  return GAMING_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

function parseDuration(iso?: string): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] ?? '0', 10) * 3600) +
         (parseInt(match[2] ?? '0', 10) * 60) +
         parseInt(match[3] ?? '0', 10);
}

function detectTopic(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();

  const topics: Record<string, string[]> = {
    music: ['موسيقى', 'أغنية', 'مطرب', 'مطربة', 'music', 'song', 'singer', 'نغمة', 'لحن', 'كليب'],
    comedy: ['كوميديا', 'مضحك', 'نكتة', 'comedy', 'funny', 'joke', 'humor', 'ضحك', 'فكاهة'],
    sports: ['رياضة', 'كرة', 'مباراة', 'sports', 'football', 'soccer', 'match', 'لاعب', 'دوري'],
    news: ['أخبار', 'خبر', 'news', 'breaking', 'تقرير', 'إعلام', 'سياسة'],
    food: ['طعام', 'طبخ', 'وصفة', 'food', 'cooking', 'recipe', 'مطبخ', 'أكل', 'مطعم', 'شيف'],
    travel: ['سفر', 'سياحة', 'travel', 'tourism', 'رحلة', 'زيارة', 'فندق', 'مطار'],
    beauty: ['مكياج', 'ميكاب', 'makeup', 'skincare', 'عناية', 'جمال', 'بيوتي', 'beauty', 'hair', 'شعر'],
    lifestyle: ['حياة', 'يوميات', 'lifestyle', 'daily', 'vlog', 'روتين', 'تجربة'],
    kids: ['أطفال', 'kids', 'children', 'cartoon', 'كرتون', 'قصة', 'أنيمي'],
    tech: ['تقنية', 'تكنولوجيا', 'tech', 'technology', 'برمجة', 'كمبيوتر', 'هاتف', 'آيفون', 'مراجعة'],
    education: ['تعليم', 'درس', 'education', 'lesson', 'tutorial', 'شرح', 'تعلم', 'دورة'],
  };

  for (const [topic, keywords] of Object.entries(topics)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return topic;
    }
  }

  return 'general';
}
