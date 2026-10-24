# Builds video segments (1920x1080, 30 fps, h264 + aac) and concatenates them.
import os, subprocess, sys, json
D=os.environ.get("HK_VIDEO_DIR","/tmp/hk-video")
WORK=D
def dur(path):
    return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",path]).decode())
def run(args):
    subprocess.run(["ffmpeg","-v","error","-y",*args],check=True)
ENC=["-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p","-r","30","-c:a","aac","-b:a","192k","-ar","48000","-ac","2"]

def slide(name, image, vo=None, length=None, lead=0.5, tail=0.9, extra_audio=None):
    """A still slide with a slow push-in; narration starts after `lead` seconds."""
    vo_len = dur(vo) if vo else 0
    total = length or (lead + vo_len + tail)
    frames = int(total*30)
    v = f"[0:v]scale=3840:-2,zoompan=z='min(zoom+0.00035,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st={total-0.35:.2f}:d=0.35[v]"
    inputs=["-loop","1","-t",f"{total:.2f}","-i",image]
    if vo:
        inputs+=["-i",vo]
        a=f"[1:a]adelay={int(lead*1000)}|{int(lead*1000)},apad,atrim=0:{total:.2f}[a]"
    else:
        inputs+=["-f","lavfi","-t",f"{total:.2f}","-i","anullsrc=r=48000:cl=stereo"]
        a="[1:a]atrim=0:{:.2f}[a]".format(total)
    run([*inputs,"-filter_complex",f"{v};{a}","-map","[v]","-map","[a]","-t",f"{total:.2f}",*ENC,f"{D}/seg/{name}.mp4"])
    print(f"{name}: {total:.1f}s")

def clip(name, video, panel, vo, start=0.0, length=None, hold=1.0, lead=0.6, clip_vol=0.35):
    """A portrait phone clip over a blurred copy of itself, with a side panel and narration."""
    src = dur(video)-start
    total = (length or src) + hold
    v=(f"[0:v]trim=start={start},setpts=PTS-STARTPTS,fps=30,split[a][b];"
       f"[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=28:4,eq=brightness=-0.32[bg];"
       f"[b]scale=-2:1000,tpad=stop_mode=clone:stop_duration={hold}[fg];"
       f"[bg]tpad=stop_mode=clone:stop_duration={hold}[bg2];"
       f"[bg2][fg]overlay=x=(1150-w)/2:y=40[base];[base][1:v]overlay=0:0,trim=0:{total:.2f},fade=t=in:st=0:d=0.35,fade=t=out:st={total-0.35:.2f}:d=0.35[v]")
    a=(f"[0:a]atrim=start={start},asetpts=PTS-STARTPTS,volume={clip_vol},apad,atrim=0:{total:.2f}[ca];"
       f"[2:a]adelay={int(lead*1000)}|{int(lead*1000)},apad,atrim=0:{total:.2f}[va];"
       f"[ca][va]amix=inputs=2:duration=longest:normalize=0,atrim=0:{total:.2f}[a]")
    run(["-i",video,"-i",panel,"-i",vo,"-filter_complex",f"{v};{a}","-map","[v]","-map","[a]","-t",f"{total:.2f}",*ENC,f"{D}/seg/{name}.mp4"])
    print(f"{name}: {total:.1f}s")

def concat(names, out):
    lst=f"{D}/seg/list.txt"
    open(lst,"w").write("".join(f"file '{D}/seg/{n}.mp4'\n" for n in names))
    run(["-f","concat","-safe","0","-i",lst,"-c","copy","-movflags","+faststart",out])
    print(f"final: {out} {dur(out):.1f}s")

if __name__=="__main__":
    part=sys.argv[1]
    if part=="first":
        slide("s1", f"{D}/cards/s1-title.png", f"{D}/vo/s1.mp3", lead=0.8, tail=1.2)
        slide("s2", f"{D}/cards/s2-problem.png", f"{D}/vo/s2.mp3")
        # the house: FalkorDB view, then the 3D view, one narration across both
        slide("s3a", f"{D}/cards/s3a.png", f"{D}/vo/s3.mp3", length=dur(f"{D}/vo/s3.mp3")*0.55+0.5)
        slide("s3b", f"{D}/cards/s3b.png", None, length=dur(f"{D}/vo/s3.mp3")*0.45+1.2)
        clip("s4", __import__("os").path.expanduser("~")+"/Downloads/IMG_5959.MOV", f"{D}/cards/s4-panel.png", f"{D}/vo/s4.mp3", hold=1.2)
        slide("s5a", f"{D}/cards/s5a.png", f"{D}/vo/s5.mp3", length=dur(f"{D}/vo/s5.mp3")*0.62+0.5)
        slide("s5b", f"{D}/cards/s5b.png", None, length=dur(f"{D}/vo/s5.mp3")*0.38+1.0)
        clip("s6", __import__("os").path.expanduser("~")+"/Downloads/IMG_5960.MOV", f"{D}/cards/s6-panel.png", f"{D}/vo/s6.mp3", hold=0.8)
        slide("s9", f"{D}/cards/s9-stack.png", f"{D}/vo/s9.mp3", lead=0.6, tail=1.8)
    if part=="second":
        slide("s7a", f"{D}/cards/s7a.png", f"{D}/vo/s7.mp3", length=dur(f"{D}/vo/s7.mp3")*0.6+0.5)
        slide("s7b", f"{D}/cards/s7b.png", None, length=dur(f"{D}/vo/s7.mp3")*0.4+1.0)
        # narrator line, then the question in Thilak's voice, then the spoken answer
        q, a, n = f"{D}/vo/q.mp3", f"{D}/vo/a.mp3", f"{D}/vo/s8.mp3"
        dn, dq, da = dur(n), dur(q), dur(a)
        total = 0.5 + dn + 0.4 + dq + 0.6 + da + 1.4
        frames = int(total*30)
        v = f"[0:v]scale=3840:-2,zoompan=z='min(zoom+0.0002,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st={total-0.35:.2f}:d=0.35[v]"
        t1=int(500); t2=int((0.5+dn+0.4)*1000); t3=int((0.5+dn+0.4+dq+0.6)*1000)
        aud=(f"[1:a]adelay={t1}|{t1}[x];[2:a]adelay={t2}|{t2}[y];[3:a]adelay={t3}|{t3}[z];"
             f"[x][y][z]amix=inputs=3:duration=longest:normalize=0,apad,atrim=0:{total:.2f}[a]")
        run(["-loop","1","-t",f"{total:.2f}","-i",f"{D}/cards/s8-qa.png","-i",n,"-i",q,"-i",a,"-filter_complex",f"{v};{aud}","-map","[v]","-map","[a]","-t",f"{total:.2f}",*ENC,f"{D}/seg/s8.mp4"])
        print(f"s8: {total:.1f}s")
        concat(["s1","s2","s3a","s3b","s4","s5a","s5b","s6","s7a","s7b","s8","s9"], f"{D}/HAWKEYE-demo.mp4")
