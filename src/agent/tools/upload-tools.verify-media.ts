import assert from 'node:assert/strict';
import { execUploadTool } from './upload-tools';
import type { ReceiptRecord, UploadVerifierFixture } from './upload-tools.verify-fixture';

export async function verifyUploadMediaFailures(fixture: UploadVerifierFixture): Promise<void> {
  const { context, draft, state } = fixture;
  const videoReceipt: ReceiptRecord = { value: {
    sessionId: 'sess_video',
    assetId: 'video-asset',
    filename: 'interview.mov',
    projectId: 'project-test',
    fileKey: 'uploads/video-asset.mov',
    readUrl: '/media/uploads/video-asset.mov',
    size: 4096,
    type: 'video',
    contentType: 'video/quicktime',
    contentHash: 'ef'.repeat(32),
  } };
  state.receipts.set('receipt-video', videoReceipt);
  const claimsBeforeMissingDuration = state.receiptClaims;
  const missingDuration = await execUploadTool('finalize_uploaded_asset', {
    receipt: 'receipt-video',
    assetType: 'video',
  }, context) as { error?: string };
  assert.match(missingDuration.error ?? '', /durationInSeconds is required/);
  assert.equal(
    state.receiptClaims,
    claimsBeforeMissingDuration,
    'conditional duration validation must run before claiming the receipt',
  );

  state.failNextNormalization = true;
  const normalizationFailure = await execUploadTool('finalize_uploaded_asset', {
    receipt: 'receipt-video',
    assetType: 'video',
    durationInSeconds: 2,
    hasAudioTrack: true,
  }, context) as { error?: string };
  assert.match(normalizationFailure.error ?? '', /Video compatibility processing failed/);
  assert.equal(videoReceipt.claimId, undefined, 'normalization failure must abort the receipt claim');
  assert.equal(videoReceipt.committed, undefined);
  assert.equal(
    draft.getDoc().assets.some((asset) => asset.id === 'video-asset'),
    false,
    'normalization failure must not publish an asset',
  );

  const finalizedVideo = await execUploadTool('finalize_uploaded_asset', {
    receipt: 'receipt-video',
    assetType: 'video',
    durationInSeconds: 2,
    hasAudioTrack: true,
    addToTimeline: true,
    trackId: 'V1',
    startFrame: 12,
  }, context) as { next?: string; transcription?: string; addedToTimeline?: boolean; timelineItemId?: string };
  assert.equal(videoReceipt.committed, true, 'successful asset commit must terminally commit the receipt');
  assert.equal(finalizedVideo.transcription, 'not_started');
  assert.match(finalizedVideo.next ?? '', /invoke transcribe_track/);
  assert.equal(finalizedVideo.addedToTimeline, true);
  assert.equal(
    draft.getState().items.find((item) => item.id === finalizedVideo.timelineItemId)?.startFrame,
    12,
    'finalize can atomically hand the imported asset off to timeline placement',
  );
  const videoAsset = draft.getDoc().assets.find((asset) => asset.id === 'video-asset');
  assert.equal(videoAsset?.transcribeStatus, undefined, 'finalize must not enqueue or mark ASR running');

  for (const [receipt, assetId] of [['receipt-batch-a', 'batch-a'], ['receipt-batch-b', 'batch-b']] as const) {
    state.receipts.set(receipt, { value: {
      sessionId: `sess_${assetId}`,
      assetId,
      filename: `${assetId}.png`,
      projectId: 'project-test',
      fileKey: `uploads/${assetId}.png`,
      readUrl: `/media/uploads/${assetId}.png`,
      size: 128,
      type: 'image',
      contentType: 'image/png',
      contentHash: (assetId === 'batch-a' ? 'ab' : 'cd').repeat(32),
    } });
  }
  const finalizedBatch = await execUploadTool('finalize_uploaded_assets', {
    items: [
      { receipt: 'receipt-batch-a', assetType: 'image', width: 640, height: 360, addToTimeline: true },
      { receipt: 'receipt-batch-b', assetType: 'image', width: 640, height: 360, addToTimeline: true },
    ],
  }, context) as { ok?: boolean; count?: number; failed?: number };
  assert.equal(finalizedBatch.ok, true);
  assert.equal(finalizedBatch.count, 2);
  assert.equal(finalizedBatch.failed, 0);
  assert.equal(draft.getDoc().assets.filter((asset) => asset.id.startsWith('batch-')).length, 2);
  assert.equal(draft.getState().items.filter((item) => item.name.startsWith('batch-')).length, 2);

  const replayedVideo = await execUploadTool('finalize_uploaded_asset', {
    receipt: 'receipt-video',
    assetType: 'video',
    durationInSeconds: 2,
  }, context) as { error?: string };
  assert.match(replayedVideo.error ?? '', /unavailable|invalid|expired|consumed/);

  const unsafe = await execUploadTool('import_media', {
    action: 'create_session',
    assetType: 'image',
    filename: 'bad\u0001.png',
    contentType: 'image/png',
    size: 1,
  }, context) as { error?: string };
  assert.match(unsafe.error ?? '', /safe basename/);
  assert.equal(state.mintedBodies.length, 2);
  const removedLegacy = await execUploadTool('request_asset_upload_url', {}, context) as { error?: string };
  assert.match(removedLegacy.error ?? '', /unknown tool/);
}
