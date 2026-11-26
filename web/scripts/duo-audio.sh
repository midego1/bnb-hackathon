#!/usr/bin/env bash
# Gives the hero video docs/submission/duo.{mp4,webm} its sound: the voice-over lines in docs/submission/duo-voiceover.md
# spoken by Piper (offline TTS), coin clinks, step ticks and a Settled chime synthesized with ffmpeg, and a quiet
# synthesized pad ducked under the voice. The picture is copied as it is (-c:v copy); only the audio track is replaced,
# so the script can run again on its own output.
#
#   python3 -m venv /tmp/piper && /tmp/piper/bin/pip install piper-tts
#   curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/high/en_GB-cori-high.onnx
#   curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/high/en_GB-cori-high.onnx.json
#   PIPER=/tmp/piper/bin/piper VOICE=./en_GB-cori-high.onnx bash web/scripts/duo-audio.sh [stemsDir]
#
# Needs ffmpeg with libopus. Levels: voice -16 LUFS integrated, effects -29 LUFS, pad -28 LUFS before ducking.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
SUB=docs/submission
PIPER=${PIPER:-piper}
VOICE=${VOICE:?set VOICE to en_GB-cori-high.onnx}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stems=${1:-$work}
mkdir -p "$stems"
SR=48000
ff() { ffmpeg -nostdin -hide_banner -v error -y "$@"; }
# The picture's length (packets x frame time), so a second run does not grow by the audio's padding.
dur() { ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets,r_frame_rate -of default=nw=1 "$1" | awk -F= '/rate/{split($2,r,"/")} /packets/{n=$2} END{printf "%.3f", n*r[2]/r[1]}'; }
lufs() { ffmpeg -nostdin -hide_banner -nostats -i "$1" -af ebur128=framelog=quiet -f null - 2>&1 | awk '/Integrated loudness/{f=1} f&&$1=="I:"{print $2; exit}'; }
# Scale a stem to a target integrated loudness (linear gain, no compression).
norm() { local g; g=$(awk -v t="$2" -v i="$(lufs "$1")" 'BEGIN{printf "%.2f", t-i}'); ff -i "$1" -af "volume=${g}dB" "$3"; }
LEN=$(awk -v a="$(dur $SUB/duo.mp4)" -v b="$(dur $SUB/duo.webm)" 'BEGIN{print (a>b?a:b)}')

# Places files at times: place OUT "t file gain" ...  -> one mono 48 kHz stem of LEN seconds.
place() {
  local out=$1; shift
  local args=() fc="" mix="" n=0 t f g
  for ev in "$@"; do
    read -r t f g <<<"$ev"
    args+=(-i "$f")
    fc+="[$n:a]aresample=$SR,aformat=channel_layouts=mono,volume=$g,adelay=$(awk -v t="$t" 'BEGIN{printf "%d", t*1000}'):all=1[e$n];"
    mix+="[e$n]"; n=$((n+1))
  done
  ff "${args[@]}" -filter_complex "${fc}${mix}amix=inputs=$n:normalize=0:duration=longest,apad,atrim=0:$LEN[o]" -map "[o]" -ar $SR "$out"
}

# 1. Voice: one Piper call per line, placed at its start.
awk '/^```tsv/{f=1;next} /^```/{f=0} f' $SUB/duo-voiceover.md > "$work/lines.tsv"
events=(); n=0
while IFS=$'\t' read -r t text; do
  printf '%s\n' "$text" | "$PIPER" -m "$VOICE" --sentence-silence 0.3 -f "$work/v$n.wav" 2>/dev/null
  events+=("$t $work/v$n.wav 1"); n=$((n+1))
done < "$work/lines.tsv"
place "$work/voice-raw.wav" "${events[@]}"
norm "$work/voice-raw.wav" -16 "$stems/voice.wav"

# 2. Effects (t is local time): a soft tick, coins (three pitches), the fee coin, a two-note chime.
src() { ff -f lavfi -i "aevalsrc=exprs='$1':s=$SR:d=$2" -af "lowpass=f=7000" "$work/$3.wav"; }
src "(0.6*sin(2*PI*1050*t)+0.3*sin(2*PI*2380*t))*exp(-t*90)*(1-exp(-t*4000))" 0.12 tick
coin() { echo "(sin(2*PI*2210*$1*t)*exp(-t*26)+0.55*sin(2*PI*3310*$1*t)*exp(-t*34)+0.35*sin(2*PI*4690*$1*t)*exp(-t*46)+0.2*sin(2*PI*6050*$1*t)*exp(-t*60))*(1-exp(-t*3000))"; }
src "$(coin 1.00)" 0.45 coin1
src "$(coin 1.07)" 0.45 coin2
src "$(coin 0.94)" 0.45 coin3
src "$(coin 1.19)" 0.6 fee
bell() { echo "gte(t,$2)*(sin(2*PI*$1*(t-$2))+0.25*sin(2*PI*2.01*$1*(t-$2)))*exp(-(t-$2)*3.2)*(1-exp(-(t-$2)*400))"; }
src "0.5*$(bell 1318.5 0)+0.5*$(bell 1975.5 0.15)" 1.9 chime
W=$work
place "$work/sfx-raw.wav" \
  "7.28 $W/tick.wav 0.5" "17.32 $W/tick.wav 0.5" "27.32 $W/tick.wav 0.5" "33.40 $W/tick.wav 0.5" \
  "17.42 $W/coin1.wav 0.9" "17.66 $W/coin3.wav 0.8" "17.90 $W/coin2.wav 0.7" "18.16 $W/coin1.wav 0.6" "18.44 $W/coin3.wav 0.5" \
  "48.40 $W/coin2.wav 0.8" "48.70 $W/coin1.wav 0.7" "49.02 $W/coin3.wav 0.6" "49.34 $W/coin2.wav 0.5" \
  "49.90 $W/fee.wav 0.9" "50.30 $W/chime.wav 0.8"
norm "$work/sfx-raw.wav" -29 "$stems/sfx.wav"

# 3. Pad: A(add9) and D/A, slowly crossfading every 16 s, sine partials with a slow swell, a little wider in stereo.
chord() { local e="" f; for f in $1; do e+="+sin(2*PI*($f+$2)*t)*(0.7+0.3*sin(2*PI*0.05*t+$f))"; done; echo "(${e:1})"; }
x="(0.5+0.5*cos(2*PI*t/32))"
A="110 164.81 246.94 277.18 329.63" D="110 146.83 220 293.66 369.99"
side() { echo "$x*$(chord "$A" $1)+(1-$x)*$(chord "$D" $1)"; }
ff -f lavfi -i "aevalsrc=exprs='$(side -0.15)|$(side 0.15)':s=$SR:d=$LEN" \
  -af "lowpass=f=900,afade=t=in:d=3,afade=t=out:st=$(awk -v l="$LEN" 'BEGIN{print l-4}'):d=4" "$work/pad-raw.wav"
norm "$work/pad-raw.wav" -28 "$stems/pad.wav"

# 4. Mix: the pad ducked by the voice, everything summed, a limiter for the peaks.
ff -i "$stems/voice.wav" -i "$stems/sfx.wav" -i "$stems/pad.wav" -filter_complex \
  "[0:a]aformat=channel_layouts=stereo,asplit[v][key];[2:a][key]sidechaincompress=threshold=0.015:ratio=6:attack=60:release=900[p];\
[1:a]aformat=channel_layouts=stereo[s];[v][s][p]amix=inputs=3:normalize=0,alimiter=limit=0.84:level=false[o]" \
  -map "[o]" -ar $SR "$stems/mix.wav"

# 5. Mux: the same picture, the new audio.
for ext in mp4 webm; do
  if [ $ext = mp4 ]; then codec=(-c:a aac -b:a 160k -movflags +faststart); else codec=(-c:a libopus -b:a 128k); fi
  ff -i $SUB/duo.$ext -i "$stems/mix.wav" -map 0:v:0 -map 1:a:0 -c:v copy "${codec[@]}" -t "$(dur $SUB/duo.$ext)" "$work/out.$ext"
  mv "$work/out.$ext" $SUB/duo.$ext
done
echo "voice $(lufs "$stems/voice.wav") LUFS, mix $(lufs "$stems/mix.wav") LUFS"
