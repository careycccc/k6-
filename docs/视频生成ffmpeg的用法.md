生成200M的视频：ffmpeg -f lavfi -i testsrc2=duration=60:size=1920x1080:rate=30 -f lavfi -i anullsrc=r=44100:cl=stereo -vf "format=yuv420p" -b:v 26.8M -minrate 26.8M -maxrate 26.8M -bufsize 50M -x264-params nal-hrd=cbr -c:v libx264 -c:a aac -shortest "D:\video\test_200M.mp4"

视频格式无损转换（极速）
ffmpeg -i input.mov -c copy output.mp4

无损剪切视频
ffmpeg -ss 00:01:00 -to 00:02:30 -i input.mp4 -c copy cut_output.mp4


提取视频中的音频
ffmpeg -i input.mp4 -vn -q:a 2 output.mp3