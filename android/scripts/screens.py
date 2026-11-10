"""Drive the installed app on the emulator and save screenshots (CI smoke test)."""
import os, re, subprocess, sys, time

OUT = sys.argv[1] if len(sys.argv) > 1 else "shots"
os.makedirs(OUT, exist_ok=True)
PKG = "com.franklintiffinroom.app"

def adb(*a, check=False):
    return subprocess.run(["adb", *a], capture_output=True, text=True, check=check).stdout

def shot(name):
    time.sleep(2.5)
    with open(f"{OUT}/{name}.png", "wb") as f:
        f.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True).stdout)
    print("shot", name)

def find(text):
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    xml = adb("shell", "cat", "/sdcard/ui.xml")
    for m in re.finditer(r'<node [^>]*>', xml):
        node = m.group(0)
        t = re.search(r'text="([^"]*)"', node); d = re.search(r'content-desc="([^"]*)"', node)
        want = text.lower()
        if (t and t.group(1).lower() == want) or (d and d.group(1).lower() == want):
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
            if b:
                x1, y1, x2, y2 = map(int, b.groups())
                return (x1 + x2) // 2, (y1 + y2) // 2
    return None

def tap(text, tries=6):
    for _ in range(tries):
        p = find(text)
        if p:
            adb("shell", "input", "tap", str(p[0]), str(p[1]))
            return True
        time.sleep(2)
    print("could not find", text)
    return False

def swipe_up():
    adb("shell", "input", "swipe", "540", "1800", "540", "700", "400")

def back():
    adb("shell", "input", "keyevent", "4")

adb("logcat", "-c")
adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
time.sleep(8)
shot("01-welcome")
tap("Enter FTR", tries=40); shot("02-home")
swipe_up(); shot("03-home-tiles")
swipe_up(); shot("04-home-bottom")
if tap("Catering Items"):
    shot("05-catering-sections")
    if tap("South Indian Catering"):
        shot("06-dishes")
        if tap("Bisi Bele Bhath"):
            shot("07-dish-sheet")
            back()
        back()
    back()
swipe_up()
adb("shell", "input", "swipe", "540", "700", "540", "1800", "400")
adb("shell", "input", "swipe", "540", "700", "540", "1800", "400")
time.sleep(1)
if tap("The OG Mysore Masala Dose"):
    shot("08-live-dose")
    back(); time.sleep(2)
if tap("Dose-in-a-Box"):
    shot("08b-dose-in-a-box")
    back(); time.sleep(2)
if tap("Orders"): shot("09-orders-signed-out")
if tap("Account"): shot("10-account")
if tap("Notifications"): shot("11-notifications")
tap("Home")
adb("shell", "input", "swipe", "540", "1800", "540", "700", "400")
if tap("Chef's Availability"): shot("12-availability")

# Chef's test recipe (debug builds open it from a launch extra).
adb("shell", "am", "force-stop", PKG)
adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity", "--es", "ftrScanCode", "CHEF-TEST")
time.sleep(8)
tap("Enter FTR", tries=40); time.sleep(6); shot("13-recipe")
swipe_up(); shot("14-recipe-method")
crash = adb("logcat", "-d", "-b", "crash")
open(f"{OUT}/crash-log.txt", "w").write(crash)
errs = adb("logcat", "-d", "FTR:W", "AndroidRuntime:E", "*:S")
open(f"{OUT}/errors-log.txt", "w").write(errs[-20000:])
print("CRASHES:" if crash.strip() else "no crashes", crash[:3000])
