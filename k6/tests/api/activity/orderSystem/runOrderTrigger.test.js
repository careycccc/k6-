import { sleep } from 'k6';
import { orderSystemConfig } from './oderyconfig.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getUserAccount } from '../../user/userAccountApi.js';
import { logger } from '../../../../libs/utils/logger.js';
import { createImageUploader } from '../../uploadFile/uploadFactory.js';
import { getActiveLangs } from '../../../../config/languageConfig.js';
import { httpClient } from '../../../../libs/http/client.js';
import { SignatureUtil } from '../../../../libs/utils/signature.js';
import { getTimeRandom } from '../../../utils/utils.js';

const TRANSLATIONS = {
    '外部链接-已登陆': {
        zh: '外部链接-已登陆',
        en: 'External Link - Logged In',
        hi: 'बाहरी लिंक - लॉग इन किया हुआ',
        es: 'Enlace externo - Conectado',
        pt: 'Link externo - Conectado',
        vi: 'Liên kết ngoài - Đã đăng nhập',
        ur: 'بیرونی لنک - لاگ ان ہے',
        ms: 'Pautan luaran - Log masuk',
        bn: 'বাহ্যিক লিঙ্ক - লগ ইন করা হয়েছে'
    },
    '外部链接-未登陆': {
        zh: '外部链接-未登陆',
        en: 'External Link - Not Logged In',
        hi: 'बाहरी लिंक - लॉग इन नहीं',
        es: 'Enlace externo - No conectado',
        pt: 'Link externo - Não conectado',
        vi: 'Liên kết ngoài - Chưa đăng nhập',
        ur: 'بیرونی لنک - لاگ ان نہیں',
        ms: 'Pautan luaran - Tidak log masuk',
        bn: 'বাহ্যিক লিঙ্ক - লগ ইন করা হয়নি'
    },
    '一对一客服-已登陆': {
        zh: '一对一客服-已登陆',
        en: 'One-on-One Customer Service - Logged In',
        hi: 'एक-से-एक ग्राहक सेवा - लॉग इन किया हुआ',
        es: 'Servicio al cliente uno a uno - Conectado',
        pt: 'Atendimento individual - Conectado',
        vi: 'Dịch vụ khách hàng 1-1 - Đã đăng nhập',
        ur: 'ون آن ون کسٹمر سروس - لاگ ان ہے',
        ms: 'Khidmat pelanggan satu-satu - Log masuk',
        bn: 'একের পর এক গ্রাহক সেবা - লগ ইন করা হয়েছে'
    },
    '一对一客服-未登陆': {
        zh: '一对一客服-未登陆',
        en: 'One-on-One Customer Service - Not Logged In',
        hi: 'एक-से-एक ग्राहक सेवा - लॉग ইন नहीं',
        es: 'Servicio al cliente uno a uno - No conectado',
        pt: 'Atendimento individual - Não conectado',
        vi: 'Dịch vụ khách hàng 1-1 - Chưa đăng nhập',
        ur: 'ون آن ون کسٹمر سروس - لاگ ان نہیں',
        ms: 'Khidmat pelanggan satu-satu - Tidak log masuk',
        bn: 'একের পর এক গ্রাহক সেবা - লগ ইন করা হয়নি'
    },
    '存款未到账自动化': {
        zh: '存款未到账自动化',
        en: 'Deposit Not Received - Automated',
        hi: 'जमा प्राप्त नहीं हुआ - स्वचालित',
        es: 'Depósito no recibido - Automatizado',
        pt: 'Depósito não recebido - Automatizado',
        vi: 'Nạp tiền chưa nhận được - Tự động',
        ur: 'رقم جمع نہیں ہوئی - خودکار',
        ms: 'Deposit belum diterima - Automatik',
        bn: 'ডিপোজিট পাওয়া যায়নি - স্বয়ংক্রিয়'
    },
    '取款未到账': {
        zh: '取款未到账',
        en: 'Withdrawal Not Received',
        hi: 'निकासी प्राप्त नहीं हुई',
        es: 'Retiro no recibido',
        pt: 'Saque não recebido',
        vi: 'Rút tiền chưa nhận được',
        ur: 'رقم نکلی نہیں',
        ms: 'Pengeluaran belum diterima',
        bn: 'উত্তোলন পাওয়া যায়নি'
    },
    '修改真实姓名半自动': {
        zh: '修改真实姓名半自动',
        en: 'Modify Real Name - Semi-Automated',
        hi: 'वास्तविक नाम संशोधित करें - अर्ध-स्वचालित',
        es: 'Modificar nombre real - Semiautomático',
        pt: 'Modificar nome real - Semi-automatizado',
        vi: 'Sửa tên thật - Bán tự động',
        ur: 'اصلی نام تبدیل کریں - نیم خودکار',
        ms: 'Ubah nama sebenar - Semi-automatik',
        bn: 'আসল নাম পরিবর্তন - আধা-স্বয়ংক্রিয়'
    },
    '修改登录密码半自动-已登陆': {
        zh: '修改登录密码半自动-已登陆',
        en: 'Change Login Password - Semi-Automated - Logged In',
        hi: 'लॉगिन पासवर्ड बदलें - अर्ध-स्वचालित - लॉग इन किया हुआ',
        es: 'Cambiar contraseña de inicio de sesión - Semiautomático - Conectado',
        pt: 'Alterar senha de login - Semi-automatizado - Conectado',
        vi: 'Đổi mật khẩu đăng nhập - Bán tự động - Đã đăng nhập',
        ur: 'لاگ ان پاس ورڈ تبدیل کریں - نیم خودکار - لاگ ان ہے',
        ms: 'Tukar kata laluan log masuk - Semi-automatik - Log masuk',
        bn: 'লগইন পাসওয়ার্ড পরিবর্তন - আধা-স্বয়ংক্রিয় - লগ ইন করা হয়েছে'
    },
    '修改登录密码半自动-未登陆': {
        zh: '修改登录密码半自动-未登陆',
        en: 'Change Login Password - Semi-Automated - Not Logged In',
        hi: 'लॉगिन पासवर्ड बदलें - अर्ध-स्वचालित - लॉग इन नहीं',
        es: 'Cambiar contraseña de inicio de sesión - Semiautomático - No conectado',
        pt: 'Alterar senha de login - Semi-automatizado - Não conectado',
        vi: 'Đổi mật khẩu đăng nhập - Bán tự động - Chưa đăng nhập',
        ur: 'لاگ ان پاس ورڈ تبدیل کریں - نیم خودکار - لاگ ان نہیں',
        ms: 'Tukar kata laluan log masuk - Semi-automatik - Tidak log masuk',
        bn: 'লগইন পাসওয়ার্ড পরিবর্তন - আধা-স্বয়ংক্রিয় - লগ ইন করা হয়নি'
    },
    '忘记会员账号': {
        zh: '忘记会员账号',
        en: 'Forgot Member Account',
        hi: 'सदस्य खाता भूल गए',
        es: 'Olvidé mi cuenta de miembro',
        pt: 'Esqueci minha conta de membro',
        vi: 'Quên tài khoản thành viên',
        ur: 'ممبر اکاؤنٹ بھول گئے',
        ms: 'Terlupa akaun ahli',
        bn: 'সদস্য অ্যাকাউন্ট ভুলে গেছি'
    },
    '忘记登录密码': {
        zh: '忘记登录密码',
        en: 'Forgot Login Password',
        hi: 'लॉगिन पासवर्ड भूल गए',
        es: 'Olvidé mi contraseña de inicio de sesión',
        pt: 'Esqueci minha senha de login',
        vi: 'Quên mật khẩu đăng nhập',
        ur: 'لاگ ان پاس ورڈ بھول گئے',
        ms: 'Terlupa kata laluan log masuk',
        bn: 'লগইন পাসওয়ার্ড ভুলে গেছি'
    },
    '会员账号解冻半自动': {
        zh: '会员账号解冻半自动',
        en: 'Unfreeze Member Account - Semi-Automated',
        hi: 'सदस्य खाता अनफ्रीज करें - अर्ध-स्वचालित',
        es: 'Descongelar cuenta de miembro - Semiautomático',
        pt: 'Desbloquear conta de membro - Semi-automatizado',
        vi: 'Mở đóng băng tài khoản thành viên - Bán tự động',
        ur: 'ممبر اکاؤنٹ کی منجمد حالت ختم کریں - نیم خودکار',
        ms: 'Buka blok akaun ahli - Semi-automatik',
        bn: 'সদস্য অ্যাকাউন্ট আনফ্রিজ - আধা-স্বয়ংক্রিয়'
    },
    '修改IFSC自动化': {
        zh: '修改IFSC自动化',
        en: 'Modify IFSC - Automated',
        hi: 'IFSC संशोधित करें - स्वचालित',
        es: 'Modificar IFSC - Automatizado',
        pt: 'Modificar IFSC - Automatizado',
        vi: 'Sửa IFSC - Tự động',
        ur: 'IFSC تبدیل کریں - خودکار',
        ms: 'Ubah IFSC - Automatik',
        bn: 'IFSC পরিবর্তন - স্বয়ংক্রিয়'
    },
    '修改银行名称自动化': {
        zh: '修改银行名称自动化',
        en: 'Modify Bank Name - Automated',
        hi: 'बैंक का नाम संशोधित करें - स्वचालित',
        es: 'Modificar nombre del banco - Automatizado',
        pt: 'Modificar nome do banco - Automatizado',
        vi: 'Sửa tên ngân hàng - Tự động',
        ur: 'بینک کا نام تبدیل کریں - خودکار',
        ms: 'Ubah nama bank - Automatik',
        bn: 'ব্যাংকের নাম পরিবর্তন - স্বয়ংক্রিয়'
    },
    '删除USDT半自动': {
        zh: '删除USDT半自动',
        en: 'Delete USDT - Semi-Automated',
        hi: 'USDT हटाएं - अर्ध-स्वचालित',
        es: 'Eliminar USDT - Semiautomático',
        pt: 'Excluir USDT - Semi-automatizado',
        vi: 'Xóa USDT - Bán tự động',
        ur: 'USDT حذف کریں - نیم خودکار',
        ms: 'Padam USDT - Semi-automatik',
        bn: 'USDT মুছুন - আধা-স্বয়ংক্রিয়'
    },
    '删除银行卡半自动': {
        zh: '删除银行卡半自动',
        en: 'Delete Bank Card - Semi-Automated',
        hi: 'बैंक कार्ड हटाएं - अर्ध-स्वचालित',
        es: 'Eliminar tarjeta bancaria - Semiautomático',
        pt: 'Excluir cartão bancário - Semi-automatizado',
        vi: 'Xóa thẻ ngân hàng - Bán tự động',
        ur: 'بینک کارڈ حذف کریں - نیم خودکار',
        ms: 'Padam kad bank - Semi-automatik',
        bn: 'ব্যাংক কার্ড মুছুন - আধা-স্বয়ংক্রিয়'
    },
    '删除PIX自动化': {
        zh: '删除PIX自动化',
        en: 'Delete PIX - Automated',
        hi: 'PIX हटाएं - स्वचालित',
        es: 'Eliminar PIX - Automatizado',
        pt: 'Excluir PIX - Automatizado',
        vi: 'Xóa PIX - Tự động',
        ur: 'PIX حذف کریں - خودکار',
        ms: 'Padam PIX - Automatik',
        bn: 'PIX মুছুন - স্বয়ংক্রিয়'
    },
    '删除电子钱包半自动': {
        zh: '删除电子钱包半自动',
        en: 'Delete E-Wallet - Semi-Automated',
        hi: 'ई-वॉलेट हटाएं - अर्ध-स्वचालित',
        es: 'Eliminar billetera electrónica - Semiautomático',
        pt: 'Excluir carteira eletrônica - Semi-automatizado',
        vi: 'Xóa ví điện tử - Bán tự động',
        ur: 'ای-والٹ حذف کریں - نیم خودکار',
        ms: 'Padam e-dompet - Semi-automatik',
        bn: 'ই-ওয়ালেট মুছুন - আধা-স্বয়ংক্রিয়'
    },
    '新增USDT半自动': {
        zh: '新增USDT半自动',
        en: 'Add USDT - Semi-Automated',
        hi: 'USDT जोड़ें - अर्ध-स्वचालित',
        es: 'Agregar USDT - Semiautomático',
        pt: 'Adicionar USDT - Semi-automatizado',
        vi: 'Thêm USDT - Bán tự động',
        ur: 'USDT شامل کریں - نیم خودکار',
        ms: 'Tambah USDT - Semi-automatik',
        bn: 'USDT যোগ করুন - আধা-স্বয়ংক্রিয়'
    },
    '删除银行卡自动化': {
        zh: '删除银行卡自动化',
        en: 'Delete Bank Card - Automated',
        hi: 'बैंक कार्ड हटाएं - स्वचालित',
        es: 'Eliminar tarjeta bancaria - Automatizado',
        pt: 'Excluir cartão bancário - Automatizado',
        vi: 'Xóa thẻ ngân hàng - Tự động',
        ur: 'بینک کارڈ حذف کریں - خودکار',
        ms: 'Padam kad bank - Automatik',
        bn: 'ব্যাংক কার্ড মুছুন - স্বয়ংক্রিয়'
    },
    '删除USDT自动化': {
        zh: '删除USDT自动化',
        en: 'Delete USDT - Automated',
        hi: 'USDT हटाएं - स्वचालित',
        es: 'Eliminar USDT - Automatizado',
        pt: 'Excluir USDT - Automatizado',
        vi: 'Xóa USDT - Tự động',
        ur: 'USDT حذف کریں - خودکار',
        ms: 'Padam USDT - Automatik',
        bn: 'USDT মুছুন - স্বয়ংক্রিয়'
    },
    '删除电子钱包自动化': {
        zh: '删除电子钱包自动化',
        en: 'Delete E-Wallet - Automated',
        hi: 'ई-वॉलेट हटाएं - स्वचालित',
        es: 'Eliminar billetera electrónica - Automatizado',
        pt: 'Excluir carteira eletrônica - Automatizado',
        vi: 'Xóa ví điện tử - Tự động',
        ur: 'ای-والٹ حذف کریں - خودکار',
        ms: 'Padam e-dompet - Automatik',
        bn: 'ই-ওয়ালেট মুছুন - স্বয়ংক্রিয়'
    },
    '修改提现密码自动化': {
        zh: '修改提现密码自动化',
        en: 'Change Withdrawal Password - Automated',
        hi: 'निकासी पासवर्ड बदलें - स्वचालित',
        es: 'Cambiar contraseña de retiro - Automatizado',
        pt: 'Alterar senha de saque - Automatizado',
        vi: 'Đổi mật khẩu rút tiền - Tự động',
        ur: 'واپسی پاس ورڈ تبدیل کریں - خودکار',
        ms: 'Tukar kata laluan pengeluaran - Automatik',
        bn: 'উত্তোলন পাসওয়ার্ড পরিবর্তন - স্বয়ংক্রিয়'
    },
    '修改提现密码半自动化': {
        zh: '修改提现密码半自动化',
        en: 'Change Withdrawal Password - Semi-Automated',
        hi: 'निकासी पासवर्ड बदलें - अर्ध-स्वचालित',
        es: 'Cambiar contraseña de retiro - Semiautomático',
        pt: 'Alterar senha de saque - Semi-automatizado',
        vi: 'Đổi mật khẩu rút tiền - Bán tự động',
        ur: 'واپسی پاس ورڈ تبدیل کریں - نیم خودکار',
        ms: 'Tukar kata laluan pengeluaran - Semi-automatik',
        bn: 'উত্তোলন পাসওয়ার্ড পরিবর্তন - আধা-স্বয়ংক্রিয়'
    },
    '其他问题': {
        zh: '其他问题',
        en: 'Other Issues',
        hi: 'अन्य समस्याएं',
        es: 'Otros problemas',
        pt: 'Outros problemas',
        vi: 'Vấn đề khác',
        ur: 'دیگر مسائل',
        ms: 'Masalah lain',
        bn: 'অন্যান্য সমস্যা'
    }
};

export const options = {
    vus: 1,
    iterations: 1,
    maxDuration: '10m'
};

const TAG = 'OrderTrigger';

export function setup() {
    logger.info(`[${TAG}] ========== 阶段 1：后台环境巡检与自动修复 ==========`);
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('管理员登录失败');

    // 巡检配置中的所有活动
    for (let i = 0; i < orderSystemConfig.length; i++) {
        const config = orderSystemConfig[i];
        const payload = {
            workOrderTypeId: config.queryId,
            isLoginForm: config.isLoginForm,
            pageNo: 1,
            pageSize: 20
        };
        
        let res = sendQueryRequest(payload, '/api/TenantForm/GetPageList', TAG, false, adminToken);
        
        // 防御性：如果是查询太频繁(msgCode: 13)，也会导致拿不到 res.list，会误判为未创建
        if (res && res.msgCode === 13) {
            logger.warn(`[${TAG}] 查询太频繁 (msgCode 13)，等待 1s 后重试查询...`);
            sleep(1);
            res = sendQueryRequest(payload, '/api/TenantForm/GetPageList', TAG, false, adminToken);
        }
        
        if (!res || !res.list || res.list.length === 0) {
            logger.warn(`[${TAG}] [未创建] 活动类型 "${config.name}" (sort: ${config.oderby}, typeId: ${config.queryId}) 不存在，正在自动新建并开启...`);
            
            // --- 动态上传图片 ---
            const uploader = createImageUploader(`../../uploadFile/img/order/${config.img}`, TAG);
            const uploadResult = uploader(adminToken);
            if (!uploadResult.success) {
                logger.error(`[${TAG}] 图片 ${config.img} 上传失败，跳过自动新建`);
                continue;
            }
            const fullUrl = uploadResult.src || uploadResult.file;
            const iconPath = fullUrl.replace(/^https?:\/\/[^\/]+\//, '');
            logger.info(`[${TAG}] 图片上传成功: ${iconPath}`);
            sleep(1);

            // --- 构建国际化翻译与字段 ---
            const translation = TRANSLATIONS[config.name];
            if (!translation) {
                logger.error(`[${TAG}] 找不到 "${config.name}" 的多语言翻译配置，跳过自动新建`);
                continue;
            }

            const buildFields = (lang) => {
                return (config.fields || []).map(field => ({
                    "id": 0,
                    "name": {
                        "id": 0,
                        "text": lang === 'en' ? field.nameEn : (lang === 'es' ? (field.nameEs || field.nameEn) : "")
                    },
                    "type": field.type,
                    "isRequired": 1,
                    "isDefault": true
                }));
            };

            const buildOutLinks = (lang) => {
                if ((config.type || 1) === 1 && (lang === 'en' || lang === 'es')) {
                    return [
                        { "name": "google", "link": "https://www.google.com", "id": 0 },
                        { "name": "git", "link": "https://github.com/", "id": 0 }
                    ];
                }
                return [];
            };

            const createPayload = {
                "type": config.type || 1,
                "iconPath": iconPath,
                "isLoginForm": config.isLoginForm,
                "dailySubmissionLimit": 0,
                "state": 1, // 创建时直接开启
                "sort": config.oderby,
                "translationData": getActiveLangs().map(lang => ({
                    "language": lang,
                    "formTitles": {
                        "id": 0,
                        "text": translation[lang] || translation.en
                    },
                    "fields": buildFields(lang),
                    "outLinks": buildOutLinks(lang)
                })),
                "fieldIdsToRemove": []
            };

            let createRes = sendRequest(createPayload, '/api/TenantForm/Create', TAG, false, adminToken);
            if (createRes && createRes.msgCode === 13) {
                logger.warn(`[${TAG}] 请求太频繁 (msgCode 13)，等待 1s 后重试新建...`);
                sleep(1);
                createRes = sendRequest(createPayload, '/api/TenantForm/Create', TAG, false, adminToken);
            }

            if (createRes && createRes.code === 0) {
                logger.info(`[${TAG}] ✅ 自动新建并开启成功: ${config.name}`);
            } else {
                logger.error(`[${TAG}] ❌ 自动新建失败: ${config.name}`);
            }
            sleep(1); // 新建后强制间隔 1s
            continue;
        }

        const allDisabled = res.list.every(item => item.state === 0);
        if (allDisabled) {
            const firstId = res.list[0].id;
            logger.info(`[${TAG}] [全部关闭] 活动 "${config.name}" (sort: ${config.oderby}, typeId: ${config.queryId}) 全被关闭，正在开启 ID: ${firstId}...`);
            const switchPayload = { id: firstId, state: 1 };
            let switchRes = sendRequest(switchPayload, '/api/TenantForm/SwitchState', TAG, false, adminToken);
            
            if (switchRes && switchRes.msgCode === 13) {
                logger.warn(`[${TAG}] 请求太频繁 (msgCode 13)，等待 1s 后重试开启...`);
                sleep(1);
                switchRes = sendRequest(switchPayload, '/api/TenantForm/SwitchState', TAG, false, adminToken);
            }

            if (switchRes && switchRes.code === 0) {
                logger.info(`[${TAG}] ✅ 活动 "${config.name}" 开启成功`);
            } else {
                logger.error(`[${TAG}] ❌ 活动 "${config.name}" 开启失败`);
            }
        } else {
            logger.info(`[${TAG}] [状态正常] 活动 "${config.name}" 已有开启的工单`);
        }
        
        sleep(1); // 防止查得太快，上一个和下一个的处理相隔1s
    }

    return { adminToken };
}

export default function (data) {
    const { adminToken } = data;

    logger.info(`\n[${TAG}] ========== 阶段 2：前台活动发现 (未登录状态) ==========`);
    
    // 获取未登录工单列表
    const formListRes = sendRequest({}, '/api/WorkOrder/GetFormList', TAG, true, '');
    
    // sendRequest 成功时会直接返回 data 数组
    if (!formListRes || !Array.isArray(formListRes) || formListRes.length === 0) {
        logger.error(`[${TAG}] ❌ 前台未登录工单列表获取为空或失败！停止未登录验证逻辑。`);
        return;
    }

    logger.info(`[${TAG}] 成功获取前台未登录工单列表，共发现 ${formListRes.length} 个可用工单\n`);

    // 随机准备一个通用测试账号供填充 UserName 字段
    logger.info(`[${TAG}] 准备抓取真实测试账号数据...`);
    let randomUserAccount = '916003199726'; // 兜底账号
    const userListRes = sendQueryRequest({}, '/api/Users/GetPageList', TAG, false, adminToken);
    if (userListRes && userListRes.list && userListRes.list.length > 0) {
        const randomUser = userListRes.list[Math.floor(Math.random() * userListRes.list.length)];
        const account = getUserAccount(adminToken, randomUser.userId);
        if (account) {
            randomUserAccount = account;
            logger.info(`[${TAG}] 成功抓取真实账号: ${randomUserAccount} (userId: ${randomUser.userId})`);
        }
    }

    logger.info(`\n[${TAG}] ========== 阶段 3 & 4：动态解析并触发工单 ==========`);
    
    // 遍历每一个挂载在未登录状态的工单，进行动态触发
    for (const form of formListRes) {
        const formId = form.id;
        const workOrderTypeId = form.workOrderTypeId;
        const displayName = form.displayName || form.workOrderTypeName || '未知工单';
        
        // 目前先只执行“一对一客服”(workOrderTypeId: 2)
        if (workOrderTypeId !== 2) {
            logger.info(`[${TAG}] ⏭️ 跳过未登录工单: [${displayName}] (目前只演示触发一对一客服)`);
            continue;
        }

        logger.info(`\n[${TAG}] 👉 开始处理目标工单: [${displayName}] (formId: ${formId}, workOrderTypeId: ${workOrderTypeId})`);
        
        // 动态查后台获取该工单的字段结构
        const formDetailData = sendRequest({ id: formId }, '/api/TenantForm/Get', TAG, false, adminToken);
        if (!formDetailData || !formDetailData.translationData || formDetailData.translationData.length === 0) {
            logger.error(`[${TAG}] ❌ 获取工单 ${formId} 详情失败，跳过`);
            continue;
        }

        // 解析需要填写的字段
        const transData = formDetailData.translationData.find(t => t.language === 'en') || formDetailData.translationData[0];
        const fields = transData.fields || [];
        
        if (fields.length === 0) {
            logger.info(`[${TAG}] 该工单不需要填写额外字段，直接提交`);
        } else {
            logger.info(`[${TAG}] 该工单需要填写 ${fields.length} 个字段，开始动态造数据...`);
        }

        const formFieldsPayload = [];
        
        for (const field of fields) {
            let value = '';
            if (field.type === 'UserName') {
                value = randomUserAccount;
            } else if (field.type === 'LongText') {
                value = `${randomUserAccount}_nologinTest_${formId}_001`;
            } else if (field.type === 'PhoneEmailCaptcha') {
                value = '123456';
            } else if (field.type === 'NewWithdrawPassword') {
                value = 'qwer1234';
            } else {
                value = 'test_fallback_value';
            }

            formFieldsPayload.push({
                typeCode: field.type,
                fieldId: field.id,
                fieldValue: value
            });
            logger.info(`[${TAG}]     -> 填充字段 [${field.type}] (fieldId: ${field.id}): ${value}`);
        }

        // 提交触发工单
        // --- 核心修复：规避后台签名不支持嵌套数组的问题 ---
        // 我们不改动底层的 signature.js，改为手动构造带有时间戳等基础字段的对象进行签名，然后再塞入数组，并禁用 httpClient 的自动签名。
        const basePayload = {
            formId: formId,
            workOrderTypeId: workOrderTypeId
        };

        const timeData = getTimeRandom();
        const dataToSign = {
            random: timeData.random,
            language: timeData.language,
            signature: '',
            timestamp: timeData.timestamp,
            ...basePayload
        };

        const signedBaseData = SignatureUtil.signRequest(dataToSign, '');
        
        // 签名完成后，再把不需要参与签名的复杂数组合并进去
        signedBaseData.formFields = formFieldsPayload;

        let submitRes = null;
        try {
            const response = httpClient.post(
                '/api/WorkOrder/Submit',
                signedBaseData,
                {
                    sign: false, // 禁用 httpClient 的再次签名
                    params: {
                        tags: { type: TAG, name: `${TAG}_Submit` }
                    }
                },
                true // isDesk
            );
            
            if (response && response.status === 200) {
                submitRes = JSON.parse(response.body);
            }
        } catch (e) {
            logger.error(`[${TAG}] 提交请求异常: ${e.message}`);
        }

        if (submitRes && submitRes.msgCode === 13) {
            logger.warn(`[${TAG}] 提交过快 (msgCode 13)，等待 1s 后重试...`);
            sleep(1);
            try {
                const retryResponse = httpClient.post(
                    '/api/WorkOrder/Submit',
                    signedBaseData,
                    { sign: false, params: { tags: { type: TAG, name: `${TAG}_Submit` } } },
                    true
                );
                if (retryResponse && retryResponse.status === 200) {
                    submitRes = JSON.parse(retryResponse.body);
                }
            } catch (e) {}
        }

        if (submitRes && submitRes.code === 0) {
            logger.info(`[${TAG}] ✅ 工单 [${displayName}] 成功触发！`);
        } else {
            logger.error(`[${TAG}] ❌ 工单 [${displayName}] 触发失败: ${JSON.stringify(submitRes)}`);
        }
        
        sleep(1.5);
    }
    
    logger.info(`\n[${TAG}] ========== 🎉 脚本测试完成！ ==========`);
}
