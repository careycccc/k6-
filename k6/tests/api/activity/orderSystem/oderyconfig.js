export const orderSystemConfig = [
    {
        name: '外部链接-已登陆',
        oderby: 1,
        img: '1.png',
        type: 1,
        fields: []
    },
    {
        name: '外部链接-未登陆',
        oderby: 2,
        img: '2.png',
        type: 1,
        fields: []
    },
    {
        name: '一对一客服-已登陆',
        oderby: 3,
        img: '3.png',
        type: 2,
        fields: [
            { type: 'LongText', nameEn: 'Long Text' }
        ]
    },
    {
        name: '一对一客服-未登陆',
        oderby: 4,
        img: '4.png',
        type: 2,
        fields: [
            { type: 'UserName', nameEn: 'User Name' },
            { type: 'LongText', nameEn: 'Long Text' }
        ]
    },
    {
        name: '存款未到账自动化',
        oderby: 5,
        img: '5.png',
        type: 4,
        fields: [
            { type: 'DepositOrderNo', nameEn: 'Deposit Order No' },
            { type: 'OrderAmount', nameEn: 'Order Amount' }
        ]
    },
    {
        name: '取款未到账',
        oderby: 6,
        img: '6.png',
        type: 5,
        fields: [
            { type: 'WithdrawOrderNo', nameEn: 'Withdraw Order No' },
            { type: 'WithdrawAmount', nameEn: 'Withdraw Amount' }
        ]
    },
    {
        name: '修改真实姓名半自动',
        oderby: 7,
        img: '7.png',
        type: 7,
        fields: [
            { type: 'RealName', nameEn: 'Real Name' }
        ]
    },
    {
        name: '修改登录密码半自动-已登陆',
        oderby: 8,
        img: '8.png',
        type: 8,
        fields: [
            { type: 'NewPassword', nameEn: 'New Password' }
        ]
    },
    {
        name: '修改登录密码半自动-未登陆',
        oderby: 9,
        img: '9.png',
        type: 8,
        fields: [
            { type: 'UserName', nameEn: 'User Name' },
            { type: 'NewPassword', nameEn: 'New Password' }
        ]
    },
    {
        name: '忘记会员账号',
        oderby: 10,
        img: '10.png',
        type: 9,
        fields: [
            { type: 'UserName', nameEn: 'User Name' }
        ]
    },
    {
        name: '忘记登录密码',
        oderby: 11,
        img: '11.png',
        type: 10,
        fields: [
            { type: 'UserName', nameEn: 'User Name' }
        ]
    },
    {
        name: '会员账号解冻半自动',
        oderby: 12,
        img: '12.png',
        type: 10,
        fields: [
            { type: 'UserName', nameEn: 'User Name' }
        ]
    },
    {
        name: '修改IFSC自动化',
        oderby: 13,
        img: '13.png',
        type: 11,
        fields: [
            { type: 'BankAccountNumber', nameEn: 'Bank Account Number' },
            { type: 'IFSC', nameEn: 'IFSC' },
            { type: 'PhoneEmailCaptcha', nameEn: 'Phone/Email Captcha' }
        ]
    },
    {
        name: '修改银行名称自动化',
        oderby: 14,
        img: '14.png',
        type: 12,
        fields: [
            { type: 'BankName', nameEn: 'Bank Name' },
            { type: 'BankAccountNumber', nameEn: 'Bank Account Number' },
            { type: 'PhoneEmailCaptcha', nameEn: 'Phone/Email Captcha' }
        ]
    },
    {
        name: '删除USDT半自动',
        oderby: 15,
        img: '15.png',
        type: 13,
        fields: [
            { type: 'UsdtAddress', nameEn: 'USDT Address' }
        ]
    },
    {
        name: '删除银行卡半自动',
        oderby: 16,
        img: '16.png',
        type: 14,
        fields: [
            { type: 'BankAccountNumber', nameEn: 'Bank Account Number' }
        ]
    },
    {
        name: '删除PIX自动化',
        oderby: 17,
        img: '17.png',
        type: 15,
        fields: [
            { type: 'PixAccount', nameEn: 'Pix Account' },
            { type: 'PixType', nameEn: 'Pix Type' },
            { type: 'PhoneEmailCaptcha', nameEn: 'Phone/Email Captcha' }
        ]
    },
    {
        name: '删除电子钱包半自动',
        oderby: 18,
        img: '18.png',
        type: 16,
        fields: [
            { type: 'EWallet', nameEn: 'E-Wallet' }
        ]
    },
    {
        name: '新增USDT半自动',
        oderby: 19,
        img: '19.png',
        type: 17,
        fields: [
            { type: 'UsdtAddress', nameEn: 'USDT Address' }
        ]
    },
    {
        name: '删除银行卡自动化',
        oderby: 20,
        img: '20.png',
        type: 18,
        fields: [
            { type: 'BankAccountNumber', nameEn: 'Bank Account Number' },
            { type: 'PhoneEmailCaptcha', nameEn: 'Phone/Email Captcha' }
        ]
    },
    {
        name: '删除USDT自动化',
        oderby: 21,
        img: '21.png',
        type: 19,
        fields: [
            { type: 'UsdtAddress', nameEn: 'USDT Address' },
            { type: 'PhoneEmailCaptcha', nameEn: 'Phone/Email Captcha' }
        ]
    },
    {
        name: '删除电子钱包自动化',
        oderby: 22,
        img: '22.png',
        type: 16,
        fields: [
            { type: 'EWallet', nameEn: 'E-Wallet' }
        ]
    },
    {
        name: '修改提现密码自动化',
        oderby: 23,
        img: '23.png',
        type: 21,
        fields: [
            { type: 'NewWithdrawPassword', nameEn: 'New Withdraw Password' },
            { type: 'PhoneEmailCaptcha', nameEn: 'Phone/Email Captcha' }
        ]
    },
    {
        name: '修改提现密码半自动化',
        oderby: 24,
        img: '24.png',
        type: 22,
        fields: [
            { type: 'NewWithdrawPassword', nameEn: 'New Withdraw Password' }
        ]
    },
    {
        name: '其他问题',
        oderby: 25,
        img: '25.png',
        type: 3,
        fields: [
            { type: 'LongText', nameEn: 'Long Text' }
        ]
    }
]
