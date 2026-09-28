FROM debian:bookworm-slim

COPY install-tex.sh /tmp/install-tex.sh
# A Windows checkout can give the script CRLF line endings, which sh rejects; strip them first.
RUN sed -i 's/\r$//' /tmp/install-tex.sh && sh /tmp/install-tex.sh && rm /tmp/install-tex.sh

WORKDIR /work
CMD ["sleep", "infinity"]
