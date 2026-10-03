#!/bin/bash
# usage: assemble-b.sh MALL.mp4 CAMPFIRE.mp4 OUT.mp4
set -e
FF=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
V="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=24,format=yuv420p,setsar=1"
A="aresample=48000,aformat=channel_layouts=stereo"
$FF -v error -y -i "$1" -t 12 -vf "$V" -af "$A" -c:v libx264 -crf 18 -c:a aac -ar 48000 b1.mp4
# bridge: hold the last frame with a slow push-in, under the voiceover
$FF -v error -y -sseof -0.1 -i "$1" -frames:v 1 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" last.png
$FF -v error -y -loop 1 -i last.png -f lavfi -i "anullsrc=r=48000:cl=stereo" -t 4 -vf "scale=2160:3840,zoompan=z='1+0.0015*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=96:s=1080x1920:fps=24,format=yuv420p" -c:v libx264 -crf 18 -c:a aac b2.mp4
card() { $FF -v error -y -f lavfi -i "color=c=0xE2C5A6:s=1080x1920:r=24:d=$1" -f lavfi -i "anullsrc=r=48000:cl=stereo" -t "$1" -vf "drawbox=x=80:y=380:w=920:h=1160:color=0x8C4135@0.9:t=6,format=yuv420p" -c:v libx264 -crf 18 -c:a aac "$2"; }
card 9 b3.mp4; card 10 b4.mp4; card 6 b5.mp4; card 10 b6.mp4
# campfire: its generated audio is murmured pseudo-Arabic, so it is muted
$FF -v error -y -i "$2" -t 9 -vf "$V" -af "$A,volume=0" -c:v libx264 -crf 18 -c:a aac -ar 48000 b7.mp4
printf "file '%s'\n" b1.mp4 b2.mp4 b3.mp4 b4.mp4 b5.mp4 b6.mp4 b7.mp4 > list-b.txt
$FF -v error -y -f concat -safe 0 -i list-b.txt -c copy joined-b.mp4
$FF -v error -y -i joined-b.mp4 -loop 1 -i lockup.png -filter_complex \
 "[1:v]scale=440:440,format=rgba,fade=t=in:st=51.4:d=0.6:alpha=1[l];[0:v][l]overlay=x=(W-w)/2:y=210:enable='gte(t,51.4)',subtitles=cut-b.ass:fontsdir=fonts[v]" \
 -map "[v]" -map 0:a -c:v libx264 -crf 18 -preset slow -c:a aac -b:a 192k -shortest -movflags +faststart "$3"
