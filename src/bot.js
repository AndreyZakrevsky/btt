import ccxt from 'ccxt';
import Big from 'big.js';
import 'dotenv/config';
import { DatabaseLocal } from './services/localDb.service.js';
import { Telegraf } from 'telegraf';

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

        this.tg_bot.launch();
        process.once('SIGINT', () => this.tg_bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.tg_bot.stop('SIGTERM'));
    }

    async tick() {
        while (true) {
            await this._sleep(this.configTrade.tickInterval);
            await this._trade();
            this.tickCount += 1;
        }
    }

    async _trade() {
        const baseBalance = await this._getBaseBalance();
        const assetBalance = await this._getAssetBalance();
        const { averageSellPrice = 0, amount = 0 } = await this.dbService.getData();

        this.averageSellPrice = averageSellPrice;
        this.sellAmount = amount;
        const currentMarketPrice = await this._getLastMarketPrice();

        if (!currentMarketPrice) return;

        if (averageSellPrice === 0) {
            return await this._sell(this.configTrade.sellStepInUsdt);
        }

        // return await this._buy(this.sellAmount);

        const priceDifference = new Big(currentMarketPrice).minus(new Big(this.averageSellPrice)).toNumber();

        if (priceDifference > 0) {
            if (this.averageSellPrice + this.configTrade.clearanceSell < currentMarketPrice && baseBalance > this.configTrade.sellStepInUsdt) {
                await this._notifyTelegram(`Selling at price: ${currentMarketPrice}`);
                return await this._sell(this.configTrade.sellStepInUsdt);
            }
        }

        if (priceDifference < 0) {
            if (this.averageSellPrice - this.configTrade.clearanceBuy >= currentMarketPrice) {
                await this._notifyTelegram(`Buying at price: ${currentMarketPrice}`);
                return await this._buy(this.sellAmount);
            }
        }
    }

    async _sell(amount) {
        try {
            const { status, price, fee } = await this.binanceClient.createMarketSellOrder(this.market, amount);

            if (status === 'closed') {
                const notification = `🔴 SELL completed at price: ${price} (fee: ${fee?.cost || 0})`;
                console.log(notification);
                await this.dbService.setData(amount, price, fee?.cost || 0);
                await this._notifyTelegram(notification);
            }
        } catch (e) {
            console.log('SELL || ', e.message);
            await this._notifyTelegram(`❌ SELL ERROR: ${e.message}`);
        }
    }

    async _buy(amount) {
        try {
            const { status, price } = await this.binanceClient.createMarketBuyOrder(this.market, amount);

            if (status === 'closed' && price) {
                const notification = `🟢 BUY completed at price: ${price}, amount: ${amount}`;
                console.log(notification);
                await this.dbService.updateData(price);
                await this._notifyTelegram(notification);
            }
        } catch (e) {
            console.log('BUY || ', e.message);
            await this._notifyTelegram(`❌ BUY ERROR: ${e.message}`);
        }
    }

    async _notifyTelegram(message) {
        try {
            const chatId = process.env.TG_CHAT_ID;
            if (chatId) await this.tg_bot.telegram.sendMessage(chatId, message);
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
}
