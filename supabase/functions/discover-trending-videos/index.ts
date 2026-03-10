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
  'gaming', 'gameplay', 'gamer', 'game review', 'let\'s play', 'playthrough',
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
  items: YouTubeVideo[];
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const allCandidates: any[] = [];
    // Track seen video IDs across all regions to prevent cross-region duplicates
    const seenVideoIds = new Set<string>();

    for (const region of GULF_REGIONS) {
      console.log(`Fetching trending videos from region: ${region}`);

      try {
        const trendingUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=${region}&maxResults=20&key=${YOUTUBE_API_KEY}`;

        const response = await fetch(trendingUrl);

        if (!response.ok) {
          console.error(`Failed to fetch trending videos for ${region}:`, response.status, await response.text());
          continue;
        }

        const data: YouTubeResponse = await response.json();
        const regionCandidates: any[] = [];

        for (const video of data.items) {
          // Skip if already seen from another region
          if (seenVideoIds.has(video.id)) {
            console.log(`Skipping duplicate video across regions: ${video.snippet.title}`);
            continue;
          }

          // Filter: must have Arabic content
          const hasArabicTitle = /[\u0600-\u06FF]/.test(video.snippet.title);
          const hasArabicDescription = /[\u0600-\u06FF]/.test(video.snippet.description || '');
          if (!hasArabicTitle && !hasArabicDescription) {
            console.log(`Skipping non-Arabic video: ${video.snippet.title}`);
            continue;
          }

          // Filter: exclude Quran / religious recitation
          if (isQuranContent(video.snippet.title, video.snippet.description || '')) {
            console.log(`Skipping Quran/recitation video: ${video.snippet.title}`);
            continue;
          }

          // Filter: exclude gaming content
          if (isGamingContent(video.snippet.title, video.snippet.description || '', video.snippet.categoryId)) {
            console.log(`Skipping gaming video: ${video.snippet.title}`);
            continue;
          }

          // Parse duration
          const durationSeconds = parseDuration(video.contentDetails?.duration);

          // Filter: skip YouTube Shorts (< 60s) and full-length films (> 60min)
          if (durationSeconds > 0 && (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS)) {
            console.log(`Skipping video outside duration range (${durationSeconds}s): ${video.snippet.title}`);
            continue;
          }

          const viewCount = parseInt(video.statistics?.viewCount || '0');
          const likeCount = parseInt(video.statistics?.likeCount || '0');
          const commentCount = parseInt(video.statistics?.commentCount || '0');

          // Balanced trending score: 40% reach (views), 30% engagement ratio (like rate), 30% discussion (comments)
          const likeRatio = viewCount > 0 ? (likeCount / viewCount) * 100 : 0;
          const trendingScore = Math.floor(
            (viewCount / 10000) * 40 +
            likeRatio * 30 +
            (commentCount / 1000) * 30
          );

          if (trendingScore < 10) {
            console.log(`Skipping low-engagement video: ${video.snippet.title} (score: ${trendingScore})`);
            continue;
          }

          regionCandidates.push({
            video_id: video.id,
            platform: 'youtube',
            url: `https://www.youtube.com/watch?v=${video.id}`,
            title: video.snippet.title,
            creator_name: video.snippet.channelTitle,
            creator_handle: video.snippet.channelId,
            thumbnail_url: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
            view_count: viewCount,
            trending_score: trendingScore,
            detected_topic: detectTopic(video.snippet.title, video.snippet.description || ''),
            region_code: region,
            duration_seconds: durationSeconds || null,
            discovered_at: new Date().toISOString(),
          });
        }

        // Sort by trending score descending and take the top 5 for this region
        regionCandidates.sort((a, b) => b.trending_score - a.trending_score);
        const top5 = regionCandidates.slice(0, MAX_PER_REGION);

        for (const c of top5) {
          seenVideoIds.add(c.video_id);
          allCandidates.push(c);
          console.log(`Keeping Gulf Arabic video: ${c.title} (${region}, score: ${c.trending_score})`);
        }

        console.log(`Region ${region}: ${regionCandidates.length} passed filters, keeping top ${top5.length}`);
      } catch (error) {
        console.error(`Error processing region ${region}:`, error);
        continue;
      }
    }

    console.log(`Total Gulf Arabic candidates to save: ${allCandidates.length}`);

    if (allCandidates.length > 0) {
      const insertResponse = await fetch(`${supabaseUrl}/rest/v1/trending_video_candidates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify(allCandidates),
      });

      if (!insertResponse.ok) {
        const error = await insertResponse.text();
        console.error('Failed to save candidates:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to save video candidates' }),
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
        message: `Discovered ${allCandidates.length} trending Gulf Arabic videos (max ${MAX_PER_REGION} per country)`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in discover-trending-videos:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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
  return (parseInt(match[1] || '0') * 3600) + (parseInt(match[2] || '0') * 60) + parseInt(match[3] || '0');
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
