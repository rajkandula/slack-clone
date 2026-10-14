import { S3Client } from "@aws-sdk/client-s3";

const bucketName = process.env.STORAGE_BUCKET;
const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
const endpoint = process.env.STORAGE_ENDPOINT;
const publicUrl = process.env.STORAGE_PUBLIC_URL;

export const isStorageConfigured = !!(
  bucketName &&
  accessKeyId &&
  secretAccessKey &&
  endpoint &&
  publicUrl
);

export const storageClient = isStorageConfigured
  ? new S3Client({
      region: "auto",
      endpoint: endpoint,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    })
  : null;

export const STORAGE_BUCKET_NAME = bucketName;
export const STORAGE_PUBLIC_BASE = publicUrl;
