mobsf / mobsf
docker run -it -p 8000:8000 opensecurity/mobile-security-framework-mobsf:latest

// 抓取flutter的日志，通过adb
adb logcat -s "flutter" "flutter_engine" "ImageDecoder" "Skia" "Impeller"
// 抓取异常的日志
第一步：找出 App 的“包名”
 adb shell dumpsys window | findstr mCurrentFocus  # 包名（包名就是斜杠 / 前面的那一串）

 第二步：查出App 现在的 PID（进程号）
 com.example.cpgame  # 包名（包名就是斜杠 / 前面的那一串）
 adb shell pidof  com.example.cpgame

第三步：使用 --pid 精准狙击！
 adb logcat --pid=2674 *:E

 因为每次重启都会换pid，可以直接使用包名来抓取日志
 adb logcat *:E | findstr "com.example.cpgame"


 // 测流畅度:重点看 Janky frames（卡顿帧比例）
 adb shell dumpsys gfxinfo <包名>

  adb shell dumpsys gfxinfo com.example.cpgame

 // 测内存： 观察 TOTAL 的 PSS 内存变化

adb shell dumpsys meminfo <包名>

adb shell dumpsys meminfo com.example.cpgame
adb shell run-as com.example.cpgame id


python tools/flutter_vm_probe.py -p com.example.cpgame id