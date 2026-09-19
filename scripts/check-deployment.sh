#!/bin/sh
set -eu
qa="kudi-deploy-qa-$$"
cleanup() { docker rm -f "$qa-web" "$qa-api" "$qa-db" "$qa-redis" >/dev/null 2>&1 || true; docker network rm "$qa" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$qa" >/dev/null
docker run -d --name "$qa-db" --network "$qa" --network-alias postgres --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=kudi -e POSTGRES_PASSWORD=qaonly -e POSTGRES_DB=kudi_guide postgres:16-alpine >/dev/null
docker run -d --name "$qa-redis" --network "$qa" --network-alias redis redis:7-alpine >/dev/null
for i in $(seq 1 30); do if docker exec "$qa-db" pg_isready -U kudi -d kudi_guide >/dev/null 2>&1; then break; fi; sleep 1; done
docker run --rm --network "$qa" -e DATABASE_URL=postgresql://kudi:qaonly@postgres:5432/kudi_guide kudi-guide-deploy-check ./node_modules/.bin/prisma migrate deploy >/dev/null
docker run -d --name "$qa-api" --network "$qa" --network-alias api -e DATABASE_URL=postgresql://kudi:qaonly@postgres:5432/kudi_guide -e REDIS_URL=redis://redis:6379 -e JWT_SECRET=synthetic-only-long-secret-for-container-qa -e S3_ACCESS_KEY_ID=unused -e S3_SECRET_ACCESS_KEY=unused -e S3_BUCKET=unused -e LLM_ENABLED=false kudi-guide-deploy-check >/dev/null
docker run -d --name "$qa-web" --network "$qa" --network-alias web -e API_INTERNAL_URL=http://api:4000 -e APP_ORIGIN=https://app.example.test kudi-guide-web-deploy-check >/dev/null
for i in $(seq 1 30); do if docker exec "$qa-api" node -e "fetch('http://web:3000/onboarding').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi; sleep 1; done
docker exec -i "$qa-api" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const headers={'content-type':'application/json','host':'app.example.test','origin':'https://app.example.test','x-forwarded-proto':'https','x-forwarded-host':'app.example.test'};
const r=await fetch('http://web:3000/api/auth/register',{method:'POST',headers,body:JSON.stringify({nickname:'Docker QA',username:'docker_qa',email:'docker_qa@example.test',password:'Docker-QA-only-long-password'})});
assert.equal(r.status,201,await r.clone().text());
const cross=await fetch('http://web:3000/api/auth/login',{method:'POST',headers:{...headers,origin:'https://untrusted.example'},body:'{}'});assert.equal(cross.status,403);
const cookie=r.headers.get('set-cookie');assert.match(cookie,/Secure/i);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Max-Age=2592000/i);
const me=await fetch('http://web:3000/api/auth/me',{headers:{host:'app.example.test',cookie:cookie.split(';')[0]}});assert.equal(me.status,200);assert.equal((await me.json()).user.nickname,'Docker QA');
console.log('PASS: isolated containers, Prisma migrations, production API/web startup, proxy-origin signup, secure persistent cookie and authenticated reload. No real bot or data used.');
JS
