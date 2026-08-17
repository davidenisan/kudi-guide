import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { env } from "../config/env.js";

export const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

type UploadFileInput = {
  body: Buffer | Uint8Array | string;
  contentType?: string;
  originalName?: string;
  prefix?: string;
};

export async function uploadFile({
  body,
  contentType,
  originalName,
  prefix = "uploads",
}: UploadFileInput) {
  const extension = originalName ? extname(originalName) : "";
  const key = `${prefix}/${randomUUID()}${extension}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return key;
}
