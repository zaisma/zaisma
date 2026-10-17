# Makes PhotoDNA Edge Hashes for the photodna Worker. sharp reads the picture; Microsoft's SDK hashes it.
# sdk/photoDnaEdgeHashS.js isn't in the repo: npm run ship copies it in from Julius's machine.
FROM node:22-slim
WORKDIR /app
RUN npm install --omit=dev sharp@0.34.4
COPY server.mjs ./
COPY sdk/photoDnaEdgeHashS.js ./sdk/
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
