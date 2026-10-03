#!/bin/bash
# usage: assemble.sh AIRPORT.mp4 DINNER.mp4 CAMPFIRE.mp4 OUT.mp4
set -e
FF=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
V="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=24,format=yuv420p,setsar=1"
A="aresample=48000,aformat=channel_layouts=stereo"
seg() { $FF -v error -y -i "$1" -t "$2" -vf "$V" -af "$A,volume=0.6" -c:v libx264 -crf 18 -c:a aac -ar 48000 "$3"; }
seg "$1" 5 s1.mp4; seg "$2" 5 s2.mp4; seg "$3" 8 s8.mp4
card() { $FF -v error -y -f lavfi -i "color=c=0xE2C5A6:s=1080x1920:r=24:d=$1" -f lavfi -i "anullsrc=r=48000:cl=stereo" -t "$1" -vf "drawbox=x=80:y=380:w=920:h=1160:color=0x8C4135@0.9:t=6,format=yuv420p" -c:v libx264 -crf 18 -c:a aac "$2"; }
card 9 s3.mp4; card 10 s4.mp4; card 6 s5.mp4; card 10 s6.mp4; card 7 s7.mp4
printf "file '%s'\n" s1.mp4 s2.mp4 s3.mp4 s4.mp4 s5.mp4 s6.mp4 s7.mp4 s8.mp4 > list.txt
$FF -v error -y -f concat -safe 0 -i list.txt -c copy joined.mp4
$FF -v error -y -i joined.mp4 -loop 1 -i lockup.png -filter_complex \
 "[1:v]scale=440:440,format=rgba,fade=t=in:st=52.4:d=0.6:alpha=1[l];[0:v][l]overlay=x=(W-w)/2:y=210:enable='gte(t,52.4)',subtitles=cut.ass:fontsdir=fonts[v]" \
 -map "[v]" -map 0:a -c:v libx264 -crf 18 -preset slow -c:a aac -b:a 192k -shortest -movflags +faststart "$4"
