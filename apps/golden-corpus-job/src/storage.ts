import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, RestError } from "@azure/storage-blob";
import type { BlobArtifactWriter, DatasetManifest } from "./types.js";

export class ArtifactAlreadyExistsError extends Error {
  constructor(public readonly path: string) {
    super("golden_corpus_job_artifact_exists");
  }
}

export class AzureBlobArtifactWriter implements BlobArtifactWriter {
  private readonly containerClient;

  constructor(accountName: string, container: string) {
    const service = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, new DefaultAzureCredential());
    this.containerClient = service.getContainerClient(container);
  }

  async readManifest(path: string): Promise<DatasetManifest | null> {
    const client = this.containerClient.getBlockBlobClient(path);
    try {
      const download = await client.download();
      return JSON.parse(await streamToString(download.readableStreamBody)) as DatasetManifest;
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) return null;
      throw error;
    }
  }

  async writeImmutable(path: string, contents: string, contentType: string): Promise<void> {
    try {
      await this.containerClient.getBlockBlobClient(path).upload(contents, Buffer.byteLength(contents), {
        blobHTTPHeaders: { blobContentType: contentType },
        conditions: { ifNoneMatch: "*" },
      });
    } catch (error) {
      if (error instanceof RestError && (error.statusCode === 409 || error.statusCode === 412)) {
        throw new ArtifactAlreadyExistsError(path);
      }
      throw error;
    }
  }
}

async function streamToString(stream: NodeJS.ReadableStream | null | undefined): Promise<string> {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
