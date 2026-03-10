export declare const config: {
    exchange: {
        binance: {
            apiKey: any;
            apiSecret: any;
        };
        coinbase: {
            apiKey: any;
            apiSecret: any;
            passphrase: any;
        };
    };
    database: {
        url: any;
        redisUrl: any;
    };
    bot: {
        tradingEnabled: any;
        paperTrading: any;
        defaultExchange: any;
    };
    risk: {
        maxPositionSizeUsd: any;
        dailyLossLimitUsd: any;
        maxTradesPerDay: any;
    };
    notifications: {
        telegram: {
            botToken: any;
            chatId: any;
        };
        discord: {
            webhookUrl: any;
        };
    };
    api: {
        port: any;
        jwtSecret: any;
    };
    logging: {
        level: any;
    };
};
export default config;
//# sourceMappingURL=index.d.ts.map