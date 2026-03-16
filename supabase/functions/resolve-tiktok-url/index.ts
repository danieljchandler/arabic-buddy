import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TikTokVideoData {
  id: string;
  title: string;
  description: string;
  author: {
    uniqueId: string;
    nickname: string;
  };
  stats: {
    playCount: number;
    shareCount: number;
    commentCount: number;
    diggCount: number;
  };
  video: {
    duration: number;
  };
  createTime: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      throw new Error('URL is required');
    }

    // Validate TikTok URL
    const tiktokPattern = /(?:https?:\/\/)?(?:www\.|vm\.|m\.)?tiktok\.com\/@[\w.-]+\/video\/\d+|(?:https?:\/\/)?vm\.tiktok\.com\/[\w.-]+/;
    if (!tiktokPattern.test(url)) {
      throw new Error('Invalid TikTok URL');
    }

    // Use RapidAPI TikTok scraper
    const rapidApiKey = Deno.env.get('RAPIDAPI_KEY');
    if (!rapidApiKey) {
      throw new Error('RAPIDAPI_KEY not configured');
    }

    const response = await fetch('https://tiktok-scraper7.p.rapidapi.com/video/info', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com'
      },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      throw new Error(`TikTok API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.data) {
      throw new Error('No video data found');
    }

    const videoData: TikTokVideoData = data.data;

    // Extract metadata
    const metadata = {
      platform: 'tiktok',
      video_id: videoData.id,
      url: url,
      title: videoData.title || videoData.description || 'TikTok Video',
      creator_name: videoData.author.nickname,
      creator_handle: videoData.author.uniqueId,
      thumbnail_url: `https://p16-sign-sg.tiktokcdn.com/obj/tos-maliva-p-0068/oUAfAeQ7bfjIEBACGgAmoQD6D8D6BgD6D8DcAcD6D8D6BgD6D8DcAcD6D8D6BgD6D8DcAc~tiktok-obj-generic:s:320x320:q75.webp?from=feed`,
      view_count: videoData.stats.playCount,
      duration_seconds: Math.floor(videoData.video.duration / 1000),
      trending_score: calculateTrendingScore(videoData.stats),
      discovered_at: new Date().toISOString()
    };

    return new Response(JSON.stringify({ 
      success: true, 
      metadata,
      raw_data: videoData 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error resolving TikTok URL:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function calculateTrendingScore(stats: TikTokVideoData['stats']): number {
  // Calculate trending score based on engagement metrics
  const { playCount, shareCount, commentCount, diggCount } = stats;
  
  // Weighted scoring system
  const shareWeight = 10;
  const commentWeight = 5;
  const likeWeight = 2;
  const viewWeight = 1;
  
  const score = Math.floor(
    (shareCount * shareWeight) +
    (commentCount * commentWeight) +
    (diggCount * likeWeight) +
    (playCount * viewWeight / 1000) // Normalize view count
  );
  
  return Math.min(score, 10000); // Cap at 10000
}