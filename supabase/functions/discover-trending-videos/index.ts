import { corsHeaders } from '../_shared/cors.ts';

const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY');

// Gulf countries region codes for YouTube API
const GULF_REGIONS = [
  'SA', // Saudi Arabia
  'OM', // Oman
  'BH', // Bahrain
  'QA', // Qatar
  'AE', // United Arab Emirates
];

interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    channelId: string;
    description: string;
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

    // Discover trending videos from each Gulf region
    for (const region of GULF_REGIONS) {
      console.log(`Fetching trending videos from region: ${region}`);
      
      try {
        // Get trending videos for this region
        const trendingUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=${region}&maxResults=10&key=${YOUTUBE_API_KEY}`;
        
        const response = await fetch(trendingUrl);
        
        if (!response.ok) {
          console.error(`Failed to fetch trending videos for ${region}:`, response.status, await response.text());
          continue;
        }

        const data: YouTubeResponse = await response.json();
        
        // Process each video
        for (const video of data.items) {
          // Filter for Arabic content (basic check for Arabic characters)
          const hasArabicTitle = /[\u0600-\u06FF]/.test(video.snippet.title);
          const hasArabicDescription = /[\u0600-\u06FF]/.test(video.snippet.description || '');
          
          if (!hasArabicTitle && !hasArabicDescription) {
            console.log(`Skipping non-Arabic video: ${video.snippet.title}`);
            continue;
          }

          const viewCount = parseInt(video.statistics?.viewCount || '0');
          const likeCount = parseInt(video.statistics?.likeCount || '0');
          const commentCount = parseInt(video.statistics?.commentCount || '0');
          
          // Calculate trending score based on engagement
          const trendingScore = Math.floor(
            (viewCount / 1000) + 
            (likeCount * 2) + 
            (commentCount * 5)
          );

          // Only include videos with significant engagement
          if (trendingScore < 100) {
            console.log(`Skipping low-engagement video: ${video.snippet.title} (score: ${trendingScore})`);
            continue;
          }

          // Parse duration from ISO 8601 format (PT4M13S -> seconds)
          let durationSeconds = 0;
          if (video.contentDetails?.duration) {
            const duration = video.contentDetails.duration;
            const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (match) {
              const hours = parseInt(match[1] || '0');
              const minutes = parseInt(match[2] || '0');
              const seconds = parseInt(match[3] || '0');
              durationSeconds = hours * 3600 + minutes * 60 + seconds;
            }
          }

          const candidate = {
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
            discovered_at: new Date().toISOString()
          };

          allCandidates.push(candidate);
          console.log(`Found Gulf Arabic video: ${video.snippet.title} (${region}, score: ${trendingScore})`);
        }
      } catch (error) {
        console.error(`Error processing region ${region}:`, error);
        continue;
      }
    }

    console.log(`Total Gulf Arabic candidates found: ${allCandidates.length}`);

    // Save candidates to database
    if (allCandidates.length > 0) {
      const insertResponse = await fetch(`${supabaseUrl}/rest/v1/trending_video_candidates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(allCandidates)
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
        message: `Discovered ${allCandidates.length} trending Gulf Arabic videos`
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

function detectTopic(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  
  // Arabic and English keywords for different topics
  const topics = {
    music: ['موسيقى', 'أغنية', 'مطرب', 'مطربة', 'music', 'song', 'singer', 'نغمة', 'لحن'],
    comedy: ['كوميديا', 'مضحك', 'نكتة', 'comedy', 'funny', 'joke', 'humor', 'ضحك', 'فكاهة'],
    sports: ['رياضة', 'كرة', 'مباراة', 'sports', 'football', 'soccer', 'match', 'لاعب'],
    news: ['أخبار', 'خبر', 'news', 'breaking', 'تقرير', 'إعلام'],
    food: ['طعام', 'طبخ', 'وصفة', 'food', 'cooking', 'recipe', 'مطبخ', 'أكل'],
    travel: ['سفر', 'سياحة', 'travel', 'tourism', 'رحلة', 'زيارة'],
    lifestyle: ['حياة', 'يوميات', 'lifestyle', 'daily', 'vlog', 'روتين'],
    tech: ['تقنية', 'تكنولوجيا', 'tech', 'technology', 'برمجة', 'كمبيوتر'],
    education: ['تعليم', 'درس', 'education', 'lesson', 'tutorial', 'شرح']
  };

  for (const [topic, keywords] of Object.entries(topics)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return topic;
    }
  }

  return 'general';
}