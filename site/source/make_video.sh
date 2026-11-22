set -e
FF=/c/Users/heima/code/volley-reel/vendor/ffmpeg/bin/ffmpeg.exe
FP=/c/Users/heima/code/volley-reel/vendor/ffmpeg/bin/ffprobe.exe
"$FF" -y -hide_banner -loglevel error -loop 1 -framerate 30000/1001 -t 7 -i ../gen/x3.jpg -loop 1 -framerate 30000/1001 -t 4 -i ../gen/x1.jpg -loop 1 -framerate 30000/1001 -t 7 -i ../gen/x2.jpg \
  -filter_complex "[0]scale=1920:1072,format=yuv420p,setsar=1[a];[1]scale=1920:1072,format=yuv420p,setsar=1[b];[2]scale=1920:1072,format=yuv420p,setsar=1[c];[a][b][c]concat=n=3:v=1[v]" \
  -map "[v]" -c:v libx264 -crf 20 -preset veryfast -tune stillimage -g 60 seg.mp4
"$FF" -y -hide_banner -loglevel error -stream_loop 180 -i seg.mp4 -c copy match1.mp4
cp match1.mp4 match2.mp4
"$FP" -v error -show_entries format=duration -of csv=p=0 seg.mp4
D=$("$FP" -v error -show_entries format=duration -of csv=p=0 match1.mp4)
echo "$D"
python -c "
import json,glob
for f in glob.glob('lib/matches/*.json'):
    m=json.load(open(f,encoding='utf8')); m['durationSec']=float('$D'.strip()); json.dump(m,open(f,'w',encoding='utf8'),ensure_ascii=False,indent=2)
"
