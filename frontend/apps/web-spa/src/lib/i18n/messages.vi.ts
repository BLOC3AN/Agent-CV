/**
 * Chữ tiếng Việt trên giao diện.
 *
 * Bảng này là bản gốc: `messages.en.ts` khai kiểu theo nó, nên thêm khoá ở đây
 * mà quên dịch sẽ thành lỗi biên dịch chứ không phải một ô trống lặng lẽ trên
 * màn hình.
 *
 * Chỉ chứa chữ của GIAO DIỆN. Tiêu đề mục in trong CV nằm ở
 * `lib/cv-section-titles.ts` vì chúng bám vào `cv.language` chứ không bám vào
 * tuỳ chọn của người dùng, và còn phải chạy được ở SSR nơi không có context.
 */
export const vi = {
  // Điều hướng chung
  home: 'Trang chủ',
  cvs: 'CV của tôi',
  analyze: 'Đối chiếu việc làm',
  settings: 'Cài đặt',
  templates: 'Mẫu CV',
  preview: 'Xem trước',
  share: 'Chia sẻ',
  download: 'Tải PDF',
  logout: 'Đăng xuất',
  locale: 'Ngôn ngữ giao diện',

  // Bộ chọn ngôn ngữ của CV
  cvLanguage: 'Ngôn ngữ CV',
  cvLanguageVi: 'Tiếng Việt',
  cvLanguageEn: 'English',

  // Trạng thái bản nháp
  statusDirty: 'Chưa lưu',
  statusSaving: 'Đang lưu…',
  statusSaved: 'Đã lưu',
  statusSaveFailed: 'Lưu thất bại',
  loadingCV: 'Đang tải CV…',
  cvNotFound: 'Không tìm thấy CV',
  invalidCVId: 'Mã CV không hợp lệ',
  retry: 'Thử lại',

  // Hành động chung
  save: 'Lưu thay đổi',
  discard: 'Bỏ thay đổi',
  cancel: 'Hủy',
  close: 'Đóng',

  // Hộp thoại rời trang
  unsavedTitle: 'Thay đổi chưa lưu',
  unsavedBody: 'Bạn muốn lưu bản nháp trước khi rời trình soạn thảo?',
  saveAndLeave: 'Lưu và rời đi',

  // Hộp thoại tải PDF
  downloadDialogTitle: 'CV có thay đổi chưa lưu',
  downloadDialogBody: 'Chọn rõ phiên bản dùng để xuất PDF. Chỉ “Lưu và tải” mới tạo revision.',
  downloadDialogLabel: 'Xuất PDF với thay đổi chưa lưu',
  discardAndDownload: 'Bỏ thay đổi và tải',
  saveAndDownload: 'Lưu và tải',
  downloadFailed: 'Không tải được PDF',

  // Trợ lý AI
  openAssistant: 'Mở Trợ lý AI',

  // Popup xem trước
  previewTitle: 'Xem trước CV A4',
  previewClose: 'Đóng xem trước',
  print: 'In / Print',
  preparingPDF: 'Đang chuẩn bị PDF…',
  previewExportFailed: 'Không thể chuẩn bị PDF. Bản nháp chưa được xuất.',

  // Panel thiết kế
  cvLayout: 'Bố cục CV',
  draftUnsaved: 'Bản nháp chưa lưu',
  textAlign: 'Căn lề nội dung',
  alignLeft: 'Căn trái',
  alignRight: 'Căn phải',
  alignJustify: 'Căn đều hai bên',
  bodyFontSize: 'Cỡ chữ nội dung',
  sectionTitleFontSize: 'Cỡ tiêu đề section',
  headerFontSize: 'Cỡ header',
  lineHeight: 'Khoảng cách dòng',
  pageMargin: 'Khoảng cách trang',
  paddingTop: 'Padding trên',
  paddingBottom: 'Padding dưới',
  paddingLeft: 'Padding trái',
  paddingRight: 'Padding phải',
  nonDefaultOrder: 'Thứ tự này khác bố cục CV tiêu chuẩn. Nội dung vẫn được in theo đúng thứ tự đang chọn.',

  // Cây mục lục
  cvStructure: 'Cấu trúc CV',
  collapse: 'Thu gọn',
  expand: 'Mở rộng',
  hide: 'Ẩn',
  show: 'Hiện',
  drag: 'Kéo',
  endOfList: 'cuối danh sách',
  dropToEnd: 'Thả để chuyển node xuống cuối',

  // Trình sửa nội tuyến
  edit: 'Chỉnh sửa',
  updateDraft: 'Cập nhật bản nháp',
  closeInlineEditor: 'Đóng trình sửa nội tuyến',
  commaSeparatedHint: 'Ngăn cách thẻ bằng dấu phẩy.',

  // Lịch sử phiên bản
  versionHistory: 'Lịch sử phiên bản',
  versionHistoryHint: 'Xem lại thay đổi hoặc khôi phục một phiên bản đã lưu.',
  versionPickHint: 'Chọn một phiên bản để xem trước thay đổi.',
  noSavedVersions: 'Chưa có phiên bản đã lưu.',
  loadingHistory: 'Đang tải lịch sử phiên bản…',
  loadingPreview: 'Đang tải bản xem trước…',
  loadingShort: 'Đang tải…',
  restoring: 'Đang khôi phục…',
  restore: 'Khôi phục',
  restoreConfirmLabel: 'Xác nhận khôi phục phiên bản',
  restoreConfirmBody: 'Thao tác này tạo một phiên bản mới và giữ lại lịch sử hiện có.',
  createRestoreRevision: 'Tạo phiên bản khôi phục',
  restoreBlockedByDraft: 'Hãy lưu hoặc bỏ thay đổi trong bản nháp trước khi khôi phục phiên bản.',
  beforeChange: 'Trước khi thay đổi',
  afterChange: 'Sau thay đổi',
  noPreviousRevision: 'Không có bản trước đó cho phiên bản này.',
  noContentChange: 'Không có thay đổi nội dung so với bản trước đó.',
  historyLoadFailed: 'Không tải được lịch sử phiên bản',
  previewLoadFailed: 'Không tải được bản xem trước',
  restoreFailed: 'Không thể khôi phục phiên bản',
  changeAdded: 'Thêm mới',
  changeEdited: 'Đã sửa',
  changeRemoved: 'Đã xóa',
  sourceUser: 'Người dùng',

  // Tab và panel thiết kế
  tabSections: 'Nội dung (Sections)',
  tabDesign: 'Thiết kế (Design)',
  resetDefault: 'Đặt lại mặc định',
  template: 'Mẫu CV (Template)',
  accentColor: 'Màu chủ đạo',
  font: 'Font chữ',

  // Chuỗi có tham số
  versionNumber: 'Phiên bản {n}',
  previewVersion: 'Xem trước phiên bản {n}',
  restoreVersion: 'Khôi phục phiên bản {n}',
  restoreVersionQuestion: 'Khôi phục phiên bản {n}?',
  changeCount: '{n} thay đổi so với bản trước đó',
  dropPosition: 'Vị trí thả {label}',

  // Trang tổng quan
  welcomeBadge: 'XIN CHÀO MỪNG',
  greetingMorning: 'Chào buổi sáng,',
  greetingAfternoon: 'Chào buổi chiều,',
  greetingEvening: 'Chào buổi tối,',
  dashboardIntro: 'Tiếp tục tối ưu hóa hồ sơ năng lực của bạn theo chuẩn ATS doanh nghiệp với sự trợ giúp từ AI.',
  uploadCVNow: 'Tải CV lên ngay',
  editShort: 'Chỉnh sửa',
  cvBeingEdited: 'CV đang chỉnh sửa',
  noCVYet: 'Bạn chưa có CV nào',
  professionalProfile: 'Hồ sơ chuyên nghiệp',
  createFirstCVToStart: 'Tạo CV đầu tiên để bắt đầu',
  lastEdited: 'Lần sửa gần nhất: {at}',
  blankOrUpload: 'Tạo CV trắng hoặc tải CV hiện có lên.',
  editCVNow: 'Sửa CV ngay',
  createFirstCV: 'Tạo CV đầu tiên',
  allCVs: 'Tất cả CV',
  atsBenchmark: 'ĐIỂM CHUẨN ATS',
  profileCompleteness: 'Độ hoàn thiện hồ sơ',
  completenessHint: 'Mở chi tiết để xem phần nào đã đủ và gợi ý cải thiện từ AI.',
  meetsStandard: 'ĐẠT CHUẨN',
  managedCVs: '{n} CV đang được quản lý',
  noProfileToScore: 'Chưa có hồ sơ để đánh giá',
  details: 'Chi tiết',
  checkContact: '✓ Thông tin liên hệ & Giới thiệu',
  checkExperience: '✓ Kinh nghiệm làm việc',
  checkSkills: '✓ Kỹ năng & Công nghệ core',
  checkCertifications: '⚠ Bổ sung chứng chỉ MLOps / Deep Learning',
  covered: 'Đã đủ',
  recommended: 'Khuyên dùng',
  aiTipBadge: 'GỢI Ý TỪ AI TRỢ LÝ',
  aiTip: 'Thêm số liệu đo lường cụ thể vào các dự án (ví dụ: % tối ưu latency, doanh thu, quy mô team) — con số chính là điểm cộng lớn nhất với nhà tuyển dụng!',
  recentMatching: 'ĐỐI CHIẾU VIỆC LÀM GẦN ĐÂY',
  sampleRole: 'Vị trí AI Engineer / Edge AI',
  compatible: 'Tương thích',
  analyzeJD: 'Phân tích chi tiết JD',
  quickActions: 'HÀNH ĐỘNG NHANH',
  createNewCV: 'Tạo CV mới',
  atsTemplate: 'Mẫu chuẩn ATS',
  uploadCV: 'Tải CV lên',

  // Danh sách CV
  profileManagement: 'QUẢN LÝ HỒ SƠ',
  myCVList: 'Danh sách CV của tôi',
  myCVsHint: 'Quản lý, tạo mới và tinh chỉnh các phiên bản CV phù hợp từng vị trí ứng tuyển.',
  createNew: 'Tạo mới',
  editCV: 'Sửa CV',
  deleteAction: 'Xoá',
  searchCVs: 'Tìm kiếm theo tên hoặc vị trí...',
  noCVInList: 'Chưa có CV nào trong danh sách',
  createCVNow: '+ Tạo CV mới ngay',
  confirmDeleteCV: 'Xác nhận xoá CV',
  confirmDeleteBody: 'Bạn có chắc chắn muốn xoá CV này? Tất cả dữ liệu của CV sẽ bị xóa vĩnh viễn và không thể khôi phục.',
  deletePermanently: 'Xoá vĩnh viễn',

  // Thanh bên
  sidebarNote: 'Mô hình chạy nội bộ, tối ưu CV theo chuẩn ATS. Dữ liệu cá nhân không rời máy chủ.',

  // Thời gian tương đối
  minutesAgo: '{n} phút trước',
  hoursAgo: '{n} giờ trước',
  daysAgo: '{n} ngày trước',

  // Cài đặt
  accountSettings: 'Cài đặt tài khoản',
  settingsHint: 'Quản lý phiên đăng nhập và dữ liệu CV.',
  deleteAccount: 'Xoá tài khoản',
  deleteAccountPermanently: 'Xoá tài khoản vĩnh viễn',
  deleteAccountWarning: 'Thao tác này xoá vĩnh viễn tài khoản và toàn bộ CV, không thể khôi phục.',
  enterEmailToConfirm: 'Nhập email để xác nhận',

  // Đối chiếu việc làm
  jdAnalysis: 'Phân tích JD',
  pickCV: 'Chọn CV',
  analyzeAction: 'Phân tích',
  pasteJD: 'Dán JD (ít nhất 50 ký tự)',

  // Mẫu CV
  templateLibrary: 'THƯ VIỆN GIAO DIỆN',
  templatesTitle: 'Mẫu CV chuyên nghiệp (CV Templates)',
  templatesHint: 'Chọn mẫu CV đẹp mắt được chứng nhận chuẩn ATS bởi các chuyên gia tuyển dụng nhân sự.',
  templateModern: 'Hiện Đại (Modern)',
  templateModernHint: 'Thiết kế bố cục chuẩn A4 phẳng, thanh lịch với điểm nhấn chỉn chu nổi bật các dự án & kỹ năng cốt lõi.',
  templateModernBadge: 'Phổ biến cho Tech & AI',
  templateClassic: 'Kinh Điển (Classic)',
  templateClassicHint: 'Bố cục 1 cột truyền thống, tối ưu quét ATS cho các tập đoàn đa quốc gia và tổ chức tài chính.',
  templateClassicBadge: 'Tập đoàn & Ngân hàng',
  templateProfessional: 'Chuyên Gia (Professional)',
  templateProfessionalHint: 'Bố cục tinh gọn, làm nổi bật thành tựu quản lý, dẫn dắt đội ngũ và quá trình thăng tiến.',
  useTemplate: 'Sử dụng mẫu này',

  // Kho tri thức
  knowledgeBase: 'Kho tri thức',
  kbHint: 'Curator duyệt nguồn trước khi lời khuyên được trích dẫn.',
  noKBSources: 'Chưa có nguồn KB.',

  // Đăng nhập
  signIn: 'Đăng nhập',
  loginHint: 'Nhập email, chúng tôi gửi cho bạn một đường dẫn đăng nhập. Không cần mật khẩu.',
  sendLoginLink: 'Gửi link đăng nhập',

  // Tạo CV mới
  blankCVHint: 'Bắt đầu một CV trống, chỉnh sửa trong trình soạn thảo.',
  createCV: 'Tạo CV',

  // Tải CV lên
  uploadCVTitle: 'Tải CV lên hệ thống',
  dragDropHint: 'Kéo thả file CV vào đây hoặc',
  chooseFromComputer: 'chọn từ máy tính',
  supportedFormats: 'Hỗ trợ định dạng PDF, DOCX, TXT hoặc JSON',
  createAndEdit: 'Tạo & Chỉnh sửa CV',

  // Chia sẻ
  shareCVLink: 'Chia sẻ liên kết CV',
  shareHint: 'Liên kết này cho phép nhà tuyển dụng xem trực tuyến bản CV công khai của bạn ở định dạng A4 chuẩn.',
  copy: 'Sao chép',
  jobDescription: 'Mô tả công việc',
  analyzing: 'Đang phân tích…',

  // Luồng tải CV lên
  uploadCVStepTitle: 'Tải CV lên',
  uploadCVStepHint: 'Chọn một file PDF — hệ thống sẽ đọc và điền sẵn dữ liệu để bạn duyệt lại.',
  dropOrPickPDF: 'Kéo thả hoặc chọn file CV (PDF)',

  // Khởi tạo có hướng dẫn
  guidedStep: 'BƯỚC',
  guidedBack: 'Quay lại',
  guidedNext: 'Tiếp tục',
  guidedStepSituation: 'Tình trạng hiện tại',
  guidedStepTarget: 'Vị trí mục tiêu',
  guidedStepExperience: 'Kinh nghiệm',
  guidedStepBody: 'Nội dung chính',
  guidedStepContact: 'Liên hệ',
  situationStudent: 'Sinh viên',
  situationFresh: 'Mới ra trường',
  situationWorking: 'Đang đi làm',
  situationSwitching: 'Chuyển ngành',

  // Trợ lý AI
  assistantTitle: 'Trợ lý AI HR-Agent',
  aiModel: 'MÔ HÌNH AI',
  pickSuggestion: 'Chọn một gợi ý hoặc nhập yêu cầu để bắt đầu.',
  suggestImprove: 'Gợi ý cải thiện',
  fixSpelling: 'Sửa lỗi chính tả',
  shortenSummary: 'Rút gọn giới thiệu',
  createSummary: 'Tạo tóm tắt',
  optimiseExperience: 'Tối ưu kinh nghiệm',
  rewriteSkills: 'Viết lại kỹ năng',
  closeAssistant: 'Đóng trợ lý AI',
  sendRequest: 'Gửi yêu cầu',
  voiceInput: 'Nhập bằng giọng nói',
  messageToAssistant: 'Tin nhắn cho trợ lý',
  askAIPlaceholder: 'Yêu cầu AI chỉnh sửa CV...',

  // Rà soát import
  reviewTitle: 'Rà soát dữ liệu trước khi tạo CV',
  reviewIntro: 'Hệ thống đọc được các mục dưới đây từ file bạn tải lên — đây vẫn chỉ là PHỎNG ĐOÁN của máy cho tới khi bạn xác nhận từng mục.',
  reviewPending: 'Còn {n} mục chưa xác nhận — xác nhận từng mục bên dưới để mở khoá nút "Hoàn tất".',
  reviewOtherFields: 'Các trường khác trong mục này — xác nhận sẽ tính luôn (chỉ xem)',
  confirmItem: 'Đúng rồi',
  finishReview: 'Hoàn tất',
  fieldFullName: 'Họ tên',
  fieldTitle: 'Chức danh',
  fieldPhone: 'Điện thoại',
  fieldLocation: 'Địa điểm',
  sectionIntro: 'Thông tin cá nhân',
  reviewAllConfirmed: 'Đã xác nhận xong tất cả — có thể bấm Hoàn tất để tạo CV.',
  reviewKindIntro: 'Thông tin cá nhân',
  reviewKindEducation: 'Học vấn',
  reviewKindExperience: 'Kinh nghiệm',
  reviewKindProjects: 'Dự án',
  reviewKindSkills: 'Kỹ năng',
  reviewKindActivities: 'Hoạt động',
  reviewKindCertifications: 'Chứng chỉ',
  reviewKindLanguages: 'Ngoại ngữ',
  emptyFieldPlaceholder: 'Chưa có — điền vào đây',
  fieldCompany: 'Công ty',
  fieldPosition: 'Vị trí',
  fieldDescription: 'Mô tả',
  fieldSchool: 'Trường',
  fieldDegree: 'Bằng cấp',
  fieldMajor: 'Ngành',
  fieldProjectName: 'Tên dự án',
  fieldRole: 'Vai trò',
  fieldOrganization: 'Tổ chức',
  fieldName: 'Tên',
  fieldIssuer: 'Nơi cấp',
  fieldDate: 'Ngày',
  fieldStart: 'Bắt đầu',
  fieldEnd: 'Kết thúc',
  confirmed: 'Đã xác nhận',
  skillsCount: 'Kỹ năng ({n})',
  languagesCount: 'Ngoại ngữ ({n})',
  educationNumbered: 'Học vấn {n}',
  projectNumbered: 'Dự án {n}',
  activityNumbered: 'Hoạt động {n}',
  certificationNumbered: 'Chứng chỉ {n}',
  fieldDob: 'Ngày sinh',
  fieldPhoto: 'Ảnh',
  fieldAvatar: 'Ảnh đại diện',
  fieldIntroduce: 'Giới thiệu',
  fieldType: 'Hình thức',
  fieldUrl: 'Đường dẫn',
  fieldPeriod: 'Thời gian',
  fieldLevel: 'Trình độ',
  fieldCanonical: 'Tên chuẩn hoá',
  fieldGroup: 'Nhóm',
  fieldLinkLabel: 'Nhãn liên kết',
  fieldLinks: 'Liên kết',
  guidedTargetQuestion: 'Bạn muốn ứng tuyển vị trí nào?',
  guidedTargetPlaceholder: 'Ví dụ: Backend Engineer',
  guidedWorkedQuestion: 'Bạn đã từng đi làm chưa?',
  guidedYes: 'Có',
  guidedNo: 'Chưa',
  guidedProjectFocusOK: 'Không sao — tập trung vào dự án là hoàn toàn hợp lệ.',
  guidedStartFromLatest: 'Bắt đầu từ công việc gần nhất.',
  guidedBodyProject: 'Tên dự án',
  guidedBodyRole: 'Chức danh / vai trò gần nhất',
  guidedOrganization: 'Công ty / tổ chức',
  guidedWhatDidYouDo: 'Bạn đã làm gì?',
  guidedFullName: 'Họ và tên',
  guidedCreateFailed: 'Không tạo được CV từ luồng hướng dẫn',
  untitledCV: 'CV chưa đặt tên',
} as const

export type MessageKey = keyof typeof vi
