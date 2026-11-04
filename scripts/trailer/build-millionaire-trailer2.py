import subprocess,numpy as np,wave,os
M='/workspace/millionaire-shots/'
A='/usr/share/fonts/truetype/sand-box/google/Anton/Anton-Regular.ttf'
shots=[("teaser/local-after-desktop-map","THE COUNTDOWN IS ON"),("playtime/live-after-full","EVERY MINUTE YOU PLAY COUNTS"),
("mu/farming-a-field-tools","FARMING, REWORKED"),("mu/farming-b-fertilize","PLANT. FERTILIZE. HARVEST."),("mu/farming-c-machinery","REAL MACHINES"),
("autosell/after-fortmc-autosell-on","AUTO-SELL WHILE YOU SLEEP"),("autosell/after-freight-warehouse-sales","EVERY BUILDING HAS ITS OWN STOCK"),
("autosell/house-after-warehouse-inventory","THE CHUD CITY WAREHOUSE"),("autosell/house-after-house-sold","SELL TO THE HOUSE INSTANTLY"),
("sellall/dialog-desktop","SELL IT ALL"),("hockey/after-lobby","PVP HOCKEY"),("hockey/after-faceoff","4 V 4"),("hockey/after-goal","SCORE"),
("hockey/after-result","WIN CHIPS"),("networth/after-profile","WATCH YOUR NET WORTH CLIMB"),("mu/10-stocks-c-candles-1d","A REAL STOCK MARKET"),
("teaser/local-after-desktop-popup","EVERYTHING IN ONE UPDATE")]
D=2.6;FPS=30
# music 120bpm
sr=44100;T=3.5+len(shots)*D+4.5;t=np.arange(int(sr*T))/sr;y=np.zeros_like(t);beat=0.5
for i in range(int(T/beat)):
  s=int(i*beat*sr);n=min(int(0.35*sr),len(t)-s);tt=np.arange(n)/sr
  y[s:s+n]+=0.9*np.sin(2*np.pi*(50+90*np.exp(-tt*30))*tt)*np.exp(-tt*8)
  h=int((i*beat+0.25)*sr);m=min(int(0.05*sr),len(t)-h)
  if m>0:y[h:h+m]+=0.15*np.random.randn(m)*np.exp(-np.arange(m)/sr*80)
  if i%2==1:
    m=min(int(0.2*sr),len(t)-s);y[s:s+m]+=0.3*np.random.randn(m)*np.exp(-np.arange(m)/sr*20)
notes=[55,55,65.4,49]
for i in range(int(T/2)):
  s=int(i*2*sr);n=min(2*sr,len(t)-s);tt=np.arange(n)/sr;f=notes[i%4]
  y[s:s+n]+=0.25*np.sign(np.sin(2*np.pi*f*tt))*(0.6+0.4*np.sin(2*np.pi*4*tt))**2*0.5+0.12*np.sin(2*np.pi*f*4*tt)*np.exp(-(tt%0.25)*6)
y[:int(3.5*sr)]*=np.linspace(0.3,1,int(3.5*sr));y[-int(2*sr):]*=np.linspace(1,0,int(2*sr))
y=y/np.abs(y).max()*0.85;w=wave.open('tmp/music.wav','wb');w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr);w.writeframes((y*32767).astype('<i2').tobytes());w.close()
def esc(s):return s.replace(":","\\:").replace("'","")
def run(a):subprocess.run(a,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for W,H,tag in[(1920,1080,'h'),(1080,1920,'v')]:
  segs=[];fs=int(min(W,H)*0.09)
  def card(name,lines,dur):
    dt=",".join(f"drawtext=fontfile={A}:text='{esc(l)}':fontcolor={c}:fontsize={int(fs*k)}:x=(w-tw)/2:y=h/2+({o})*{fs}-th/2:alpha='min(1,t*3)'" for l,c,k,o in lines)
    run(['ffmpeg','-y','-f','lavfi','-i',f'color=c=0x0b0b10:s={W}x{H}:d={dur}:r={FPS}','-vf',f"drawbox=x=0:y=ih/2-{fs*2}:w=iw:h=6:color=gold:t=fill,drawbox=x=0:y=ih/2+{fs*2}:w=iw:h=6:color=gold:t=fill,{dt}",'-c:v','libx264','-pix_fmt','yuv420p',name]);segs.append(name)
  card(f'tmp/{tag}_00.mp4',[("CHUD HUB PRESENTS","white",0.4,-1.3),("THE MILLIONAIRE UPDATE","gold",1.0 if tag=='h' else 0.62,0.3)],3.5)
  for i,(f,cap) in enumerate(shots):
    n=int(D*FPS);zin=i%2==0
    z="1.0+0.0012*on" if zin else "1.15-0.0012*on"
    if tag=='h':
      vf=f"scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,zoompan=z='{z}':x='iw/2-iw/zoom/2+({1 if zin else -1})*on*1.5':y='ih/2-ih/zoom/2':d={n}:s={W}x{H}:fps={FPS}"
    else:
      vf=f"split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30,eq=brightness=-0.25[bg];[b]scale=2160:-2,zoompan=z='{z}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={n}:s=1080x608:fps={FPS}[fg];[bg][fg]overlay=0:(H-h)/2-150"
    if cap:
      yy="h-th-110" if tag=='h' else "h*0.72"
      size=fs if tag=='h' else int(fs*0.85)
      vf+=f",drawtext=fontfile={A}:text='{esc(cap)}':fontsize={size}:fontcolor=white:borderw=6:bordercolor=black:x=(w-tw)/2:y={yy}:alpha='min(1,t*5)'"
    vf+=",format=yuv420p"
    nm=f'tmp/{tag}_{i+1:02d}.mp4'
    run(['ffmpeg','-y','-loop','1','-framerate',str(FPS),'-t',str(D),'-i',(('/nonexistent/'+f+'.png') if os.path.exists('/nonexistent/'+f+'.png') else M+f+'.png'),'-filter_complex',vf,'-frames:v',str(n),'-c:v','libx264','-crf','20','-preset','fast',nm]);segs.append(nm)
  card(f'tmp/{tag}_99.mp4',[("NOV 6 - 8 PM CST","gold",1.2 if tag=='h' else 0.9,-0.3),("chudhub.club","white",0.55,1.1)],4.5)
  open(f'tmp/{tag}.txt','w').write("".join(f"file '{os.path.basename(s)}'\n" for s in segs))
  out='launch-trailer.mp4' if tag=='h' else 'launch-trailer-vertical.mp4'
  run(['ffmpeg','-y','-f','concat','-safe','0','-i',f'tmp/{tag}.txt','-i','tmp/music.wav','-c:v','libx264','-crf','21','-preset','medium','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',out])
