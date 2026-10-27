# Makes PhotoDNA Edge Hashes for the photodna Worker. sharp reads the picture; ffmpeg takes a video's frames
# (frames.mjs); Microsoft's SDK hashes them.
# sdk/photoDnaEdgeHashS.js isn't in the repo: npm run ship copies it in from Julius's machine.
FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install --omit=dev sharp@0.34.4
COPY server.mjs frames.mjs ./
COPY sdk/photoDnaEdgeHashS.js ./sdk/
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
