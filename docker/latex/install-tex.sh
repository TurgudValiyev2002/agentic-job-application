#!/bin/sh
# Installs the TeX Live subset the CV template needs. Shared by docker/latex/Dockerfile (the sandbox image
# the host app runs through `docker run`) and the app image, which runs pdflatex directly.
set -eux

# Base TeX Live: geometry, fontenc, inputenc, hyperref, titlesec, enumitem
apt-get update
apt-get install -y --no-install-recommends \
  texlive-latex-base \
  texlive-latex-recommended \
  texlive-latex-extra \
  texlive-fonts-recommended \
  lmodern \
  ca-certificates \
  curl \
  unzip

# XCharter only. texlive-fonts-extra would add ~2GB for this single font family.
# CTAN ships a flat layout, so map it into the TDS tree by hand.
curl -fsSL https://mirrors.ctan.org/fonts/xcharter.zip -o /tmp/x.zip
unzip -q /tmp/x.zip -d /tmp
T=/usr/share/texmf
mkdir -p $T/tex/latex/xcharter \
         $T/fonts/tfm/public/xcharter \
         $T/fonts/vf/public/xcharter \
         $T/fonts/type1/public/xcharter \
         $T/fonts/opentype/public/xcharter \
         $T/fonts/afm/public/xcharter \
         $T/fonts/enc/dvips/xcharter \
         $T/fonts/map/dvips/xcharter
cp /tmp/xcharter/tex/*        $T/tex/latex/xcharter/
cp /tmp/xcharter/tfm/*        $T/fonts/tfm/public/xcharter/
cp /tmp/xcharter/vf/*         $T/fonts/vf/public/xcharter/
cp /tmp/xcharter/type1/*      $T/fonts/type1/public/xcharter/
cp /tmp/xcharter/opentype/*   $T/fonts/opentype/public/xcharter/
cp /tmp/xcharter/afm/*        $T/fonts/afm/public/xcharter/
cp /tmp/xcharter/enc/*        $T/fonts/enc/dvips/xcharter/
cp /tmp/xcharter/map/*        $T/fonts/map/dvips/xcharter/
mktexlsr
updmap-sys --enable Map=XCharter.map
rm -rf /tmp/xcharter /tmp/x.zip /var/lib/apt/lists/*
