FROM debian:bookworm-slim

COPY install-tex.sh /tmp/install-tex.sh
RUN sh /tmp/install-tex.sh && rm /tmp/install-tex.sh

WORKDIR /work
CMD ["sleep", "infinity"]
