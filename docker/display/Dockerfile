# A shared virtual screen for the visible Chromium windows Indeed requires (it blocks headless browsers).
# The web app and workers draw on it over X11 (DISPLAY=display:99); open http://localhost:6080 to watch
# and to solve bot checks or sign in.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc fluxbox novnc websockify x11-utils \
 && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
# A Windows checkout can give the script CRLF line endings, which sh rejects; strip them first.
RUN sed -i 's/\r$//' /entrypoint.sh
EXPOSE 6080
CMD ["sh", "/entrypoint.sh"]
