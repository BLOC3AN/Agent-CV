/**
 * Thông báo lỗi — LUÔN tiếng Anh, không dịch theo ngôn ngữ giao diện.
 *
 * Lỗi không phải là nội dung của sản phẩm mà là tín hiệu kỹ thuật: người dùng
 * dán nó vào ô tìm kiếm, gửi cho đồng nghiệp, đính vào phiếu hỗ trợ. Một câu
 * tiếng Anh đi được tới nhiều người hơn bất kỳ bản dịch nào, kể cả với người
 * đang để giao diện tiếng Việt. Máy chủ Go cũng trả lỗi bằng tiếng Anh, nên
 * hai phía nói cùng một thứ tiếng thay vì nửa nọ nửa kia.
 *
 * Bảng này được TRẢI vào cả `messages.vi` lẫn `messages.en`, nên hai ngôn ngữ
 * dùng chung đúng một chuỗi theo cấu trúc — không phải theo thoả thuận miệng
 * mà ai đó sẽ vô tình phá khi "dịch nốt cho đủ".
 *
 * Nhãn tiến trình, chữ trên nút và mọi nội dung khác thì VẪN dịch: chúng là
 * sản phẩm, không phải tín hiệu chẩn đoán.
 */
export const errorMessages = {
  statusSaveFailed: 'Save failed',
  downloadFailed: 'Could not download the PDF',
  previewExportFailed: 'Could not prepare the PDF. The draft was not exported.',
  historyLoadFailed: 'Could not load the version history',
  previewLoadFailed: 'Could not load the preview',
  restoreFailed: 'Could not restore this version',
  guidedCreateFailed: 'Could not create a CV from the guided flow',
  errorV2NotBackfilled: 'This CV has no v2 record yet. Run the backfill and try again.',
  errorSchemaV2Invalid: 'The CV data is not in the expected format. Reload the page and try again.',
  errorNoCVSections: 'We could not find CV sections such as education, experience or skills.',
  errorFileMissing: 'The uploaded file is missing. Try uploading it again.',
  errorPDFExtractFailed: 'We could not read the contents of this PDF.',
  errorProfileCreateFailed: 'We could not build a profile from this file.',
  errorUnknownJobKind: 'This job type is not supported.',
  sendFailed: 'Could not send the message',
  jobFailed: 'Processing this CV failed. Please try again.',
  dashboardLoadFailed: 'Could not load the dashboard',
  applyFailed: 'Could not apply the proposal',
  reviewLoadFailed: 'Could not load the data to review.',
  reviewConfirmFailed: 'Could not save the confirmation for this item. Please try again.',
  reviewFinishFailed: 'Could not finish. Please try again.',
  reviewProgressReloadFailed: 'The confirmation was saved but the latest progress could not be reloaded.',
  someModelsUnavailable: 'some models are unavailable',
  analyzeStartFailed: 'Could not start the analysis',
  cvListLoadFailed: 'Could not load the CV list',
  analyzeProgressFailed: 'Could not read the analysis progress',
  uploadFailed: 'Could not upload the file.',
  jobTrackFailed: 'Could not track the processing job.',
  createCVFailed: 'Could not create the CV',
  storeLoadFailed: 'Could not load the CV',
  storeSaveFailed: 'Could not save the CV',
  storeRestoreFailed: 'Could not restore this version',
  errorNetworkUnreachable: 'Could not reach the server',
  errorServer: 'The server returned an error',
  errorStreamOpen: 'The server could not open the response stream',
  errorStreamClosed: 'The server closed the connection early',
  deleteAccountFailed: 'Could not delete the account',
  loginLinkFailed: 'Could not send the sign-in link',
  kbUpdateFailed: 'Could not update the source',
  kbLoadFailed: 'Could not load the knowledge base',
  deleteCVFailed: 'Could not delete the CV',
  cvListReadFailed: 'Could not read the CV list',
  errorAIPatchInvalidCV: 'The AI proposal produced an invalid CV.',
  errorAIPatchInvalidLayout: 'The AI proposal produced an invalid layout.',
  errorAIPatchLayoutReplace: 'The whole layout cannot be replaced from an AI proposal.',
  errorModelUnavailable: 'The AI assistant is unavailable. Please try again later.',
  errorModelOutputUnparsable: 'The AI assistant returned data we could not read — usually because the answer grew too long and was cut off. Try a narrower request, for example one section at a time.',
} as const
