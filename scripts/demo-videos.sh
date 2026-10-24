#!/bin/sh
# Builds the demo-mode videos (public/videos/observer-01.mp4 and -02.mp4) from
# the two clips in tests/fixtures/videos, so ?demo=1 has something to play and
# track. They are local only; public/videos/*.mp4 is not committed.
set -e
cd "$(dirname "$0")/.."
ffmpeg -y -loglevel error -i tests/fixtures/videos/01-remember-this-location.mov -vf scale=640:-2 -an -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p public/videos/observer-01.mp4
ffmpeg -y -loglevel error -i tests/fixtures/videos/02-recognise-and-take-snack.mov -vf scale=640:-2 -an -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p public/videos/observer-02.mp4
ls -la public/videos
