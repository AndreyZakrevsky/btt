import ccxt from 'ccxt';
import Big from 'big.js';
import 'dotenv/config';
import { DatabaseLocal } from './services/localDb.service.js';
import { Telegraf, Markup } from 'telegraf';

export class BinanceTrader {
    constructor(tradeConfig) {
        this.binanceClient = new ccxt.binance({
            apiKey: process.env.API_KEY,
            secret: process.env.API_SECRET,
            options: { adjustForTimeDifference: true },
        });

        this.tg_bot = new Telegraf(process.env.TG_TOKEN);
        this.dbService = new DatabaseLocal();
        this.configTrade = tradeConfig;
        this.market = `${tradeConfig.base}/${tradeConfig.asset}`;
        this.averageSellPrice = 0;
        this.sellAmount = 0;
        this.tickCount = 0;
        this.trading = false;
        this.currentPrice = null;

        this._setupBotInterface();

        this.tg_bot.launch();
        process.once('SIGINT', () => this.tg_bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.tg_bot.stop('SIGTERM'));
    }

    async tick() {
        while (this.trading) {
            await this._sleep(this.configTrade.tickInterval);
            this.currentPrice = await this._getLastMarketPrice();
            await this._trade();
            this.tickCount += 1;
        }
    }

    async _trade() {
        const baseBalance = await this._getBaseBalance();
        const { averageSellPrice = 0, amount = 0 } = await this.dbService.getData();

        this.averageSellPrice = averageSellPrice;
        this.sellAmount = amount;
        this.currentPrice = await this._getLastMarketPrice();

        if (!this.currentPrice) return;

        if (averageSellPrice === 0) {
            await this._notifyTelegram(`Start selling at price: ${this.currentPrice}`);
            return await this._sell(this.configTrade.sellStepInUsdt);
        }

        const priceDifference = new Big(this.currentPrice).minus(new Big(this.averageSellPrice)).toNumber();

        if (priceDifference > 0) {
            if (this.averageSellPrice + this.configTrade.clearanceSell < this.currentPrice && baseBalance > this.configTrade.sellStepInUsdt) {
                await this._notifyTelegram(`Start selling at price: ${this.currentPrice}`);
                return await this._sell(this.configTrade.sellStepInUsdt);
            }
        }

        if (priceDifference < 0) {
            if (this.averageSellPrice - this.configTrade.clearanceBuy >= this.currentPrice) {
                await this._notifyTelegram(`Start buying at price: ${this.currentPrice}`);
                return await this._buy(this.sellAmount);
            }
        }
    }

    async _sell(amount) {
        try {
            const { status, price, fee } = await this.binanceClient.createMarketSellOrder(this.market, amount);

            if (status === 'closed') {
                const notification = `🔴 SELL completed at price: ${price} (fee: ${fee?.cost || 0})`;
                await this.dbService.setData(amount, price, fee?.cost || 0);
                this.averageSellPrice = price;
                this.currentPrice = price;
                await this._notifyTelegram(notification);
            }
        } catch (e) {
            await this._notifyTelegram(`❌ SELL ERROR: ${e.message}`);
        }
    }

    async _buy(amount) {
        try {
            const { status, price } = await this.binanceClient.createMarketBuyOrder(this.market, amount);

            if (status === 'closed' && price) {
                const notification = `🟢 BUY completed at price: ${price}, amount: ${amount}`;
                await this.dbService.updateData(price);
                this.averageSellPrice = price;
                this.currentPrice = price;
                await this._notifyTelegram(notification);
            }
        } catch (e) {
            await this._notifyTelegram(`❌ BUY ERROR: ${e.message}`);
        }
    }

    async _notifyTelegram(message) {
        try {
            const chatId = process.env.TG_CHAT_ID;
            if (!chatId) return;

            await this.tg_bot.telegram.sendMessage(chatId, message);
            console.log(message);
        } catch (e) {
            console.log(`Telegram notification failed: ${e.message}`);
        }
    }

    async _getBaseBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' });
            const { free } = info?.balances.find((item) => item.asset === this.configTrade.base);
            return free ? Number(free) : null;
        } catch (e) {
            console.log('BASE BALANCE || ', e.message);
            return null;
        }
    }

    async _getAssetBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' });
            const { free } = info.balances.find((item) => item.asset === this.configTrade.asset);
            return free ? Number(free) : null;
        } catch (e) {
            console.log('ASSET BALANCE || ', e.message);
            return null;
        }
    }

    async _getLastMarketPrice() {
        try {
            const {
                info: { lastPrice = null },
            } = await this.binanceClient.fetchTicker(this.market);
            return Number(lastPrice);
        } catch (e) {
            return null;
        }
    }

    _sleep(time) {
        return new Promise((resolve) => setTimeout(resolve, time));
    }

    _setupBotInterface() {
        this.tg_bot.start(async (ctx) => {
            await ctx.reply(
                'Welcome to Binance Trader Bot! Use the buttons below to control the bot.',
                Markup.keyboard([
                    ['Start Trading', 'Stop Trading'],
                    ['Status', 'Clean'],
                ])
                    .resize()
                    .persistent()
            );
        });

        this.tg_bot.hears('Start Trading', async (ctx) => {
            if (this.trading) {
                return ctx.reply('❗ Trading is already running.');
            }

            this.trading = true;
            ctx.reply('✅ Trading has started!');
            this.tick();
        });

        this.tg_bot.hears('Stop Trading', async (ctx) => {
            if (!this.trading) {
                return ctx.reply('❗ Trading is already stopped.');
            }

            this.trading = false;
            ctx.reply('🛑 Trading has stopped!');
        });

        this.tg_bot.hears('Status', async (ctx) => {
            const operationData = await this.dbService.getData();

            const averageSellPrice = operationData.averageSellPrice || 0;

            const extendedInfo = `
Status: ${this.trading ? '✅ Running' : '🛑 Stopped'}
Current Market Price: ${this.currentPrice !== null ? this.currentPrice : 0}
Average Sell Price: ${averageSellPrice}
Sell Count: ${operationData.sellCount || 0}
Amount Sold: ${operationData.amount || 0}
Fee: ${operationData.fee || 0}
`;

            ctx.reply(extendedInfo);
        });

        this.tg_bot.hears('Clean', async (ctx) => {
            await ctx.reply(
                '⚠️ Are you sure you want to clean the database?',
                Markup.inlineKeyboard([Markup.button.callback('Yes', 'clean_confirm'), Markup.button.callback('No', 'clean_cancel')])
            );
        });

        this.tg_bot.action('clean_confirm', async (ctx) => {
            await this.dbService.cleanUp();
            ctx.reply('✅ Database cleaned successfully.');
        });

        this.tg_bot.action('clean_cancel', async (ctx) => {
            ctx.reply('❌ Clean operation canceled.');
        });
    }
}
