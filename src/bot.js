import ccxt from 'ccxt';
import Big from 'big.js';
import 'dotenv/config';
import { DatabaseLocal } from './services/localDb.service.js';
import { Telegraf, Markup } from 'telegraf';

const EXCHANGE_FEE = 0.998;
const EXCHANGE_FEE_PERCENT = 0.002;

export class BinanceTrader {
    constructor(tradeConfig) {
        this.binanceClient = new ccxt.binance({
            apiKey: process.env.API_KEY,
            secret: process.env.API_SECRET,
            options: { adjustForTimeDifference: true },
        });

        this.maxVolume = Number(tradeConfig.limitBase);
        this.volume = Number(tradeConfig.sellStepInUsdt);
        this.sellClearance = Number(tradeConfig.clearanceSell);
        this.buyClearance = Number(tradeConfig.clearanceBuy);
        this.configTrade = tradeConfig;

        this.tg_bot = new Telegraf(process.env.TG_TOKEN);
        this.dbService = new DatabaseLocal();

        this.market = `${tradeConfig.base}/${tradeConfig.asset}`;
        this.averageSellPrice = 0;
        this.sellAmount = 0;
        this.tickCount = 0;
        this.trading = false;
        this.currentPrice = null;
        this.fee = 0;

        this._setupBotInterface();

        this.tg_bot.launch();
        process.once('SIGINT', () => this.tg_bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.tg_bot.stop('SIGTERM'));
    }

    async tick() {
        while (this.trading) {
            await this._sleep(this.configTrade.tickInterval);
            await this._trade();
            this.tickCount += 1;
        }
    }

    async _trade() {
        const baseBalance = await this._getBaseBalance();
        const { averageSellPrice = 0, amount = 0, fee = 0 } = await this.dbService.getData();

        this.averageSellPrice = averageSellPrice;
        this.sellAmount = amount;
        this.fee = fee;
        this.currentPrice = await this._getLastMarketPrice();

        if (!this.currentPrice || !this.trading) return;

        if (averageSellPrice === 0) {
            return await this._sell(this.volume);
        }

        const priceDifference = new Big(this.currentPrice).minus(new Big(this.averageSellPrice)).toNumber();
        const sellClearance = this._getSellClearanceProgressive();

        if (priceDifference > 0 && this.sellAmount < this.maxVolume) {
            if (this.averageSellPrice + sellClearance < this.currentPrice && baseBalance > this.volume) {
                return await this._sell(this.volume);
            }
        }

        if (priceDifference < 0) {
            if (this.averageSellPrice - this.buyClearance >= this.currentPrice) {
                return await this._buy(this.sellAmount);
            }
        }
    }

    async finishBuying() {
        const profit = this.getCurrentProfit();

        await this.dbService.updateData(profit);
    }

    getCurrentProfit() {
        if (!this.currentPrice) return 0;

        const sellAmount = new Big(this.sellAmount);
        const currentPrice = new Big(this.currentPrice);
        const averageSellPrice = new Big(this.averageSellPrice);

        return averageSellPrice.minus(currentPrice).times(sellAmount).div(currentPrice).times(EXCHANGE_FEE).toFixed(5);
    }

    test() {
        const sellRate = 42.535;
        const buyRate = 42.44;

        const sums = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

        sums.forEach((amount) => {
            const selling = amount * sellRate;
            const buying = amount * buyRate;
            const profitBeforeCommission = selling - buying;

            const netProfit = (profitBeforeCommission / sellRate) * EXCHANGE_FEE;
            const netProfitUA = profitBeforeCommission * EXCHANGE_FEE;
            console.log(`Сума: $${amount}, Чистий прибуток: $${netProfit.toFixed(2)} (${netProfitUA} UAH)`);
        });
    }

    async _sell(amount) {
        try {
            const { status, price } = await this.binanceClient.createMarketSellOrder(this.market, amount);

            if (status === 'closed') {
                await this.dbService.setData(amount, price, amount * EXCHANGE_FEE_PERCENT);
            }
        } catch (e) {
            console.log(`❌ SELL ERROR: ${e.message}`);
        }
    }

    async _buy(amount) {
        try {
            const { status } = await this.binanceClient.createMarketBuyOrder(this.market, amount);
            if (status === 'closed') await this.finishBuying();
        } catch (e) {
            console.log(`❌ BUY ERROR: ${e.message}`);
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

    _getSellClearanceProgressive() {
        const rangeIndex = Math.floor(this.sellAmount / 100);

        return Number((this.sellClearance + rangeIndex * 0.1).toFixed(4));
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
            const { sellCount = 0, amount = 0, fee = 0, averageSellPrice = 0 } = operationData || {};
            const profit = this.getCurrentProfit();
            const sellClearance = this._getSellClearanceProgressive();
            const awaitingSell = Number(this.averageSellPrice + sellClearance).toFixed(4);
            const awaitingBuy = Number(this.averageSellPrice - this.buyClearance).toFixed(4);

            const extendedInfo = `
Status ${this.market}: ${this.trading ? '✅ Running' : '🛑 Stopped'}
Current price (UAH): ${this.currentPrice || 0}
Average price (UAH): ${Number(averageSellPrice).toFixed(4)}

Total (UAH): ${sellCount}
Sold (USDT): ${amount}
Fee: ${fee}
Limit: ${this.maxVolume}
Step: ${this.volume}
Profit: ${profit}

AWAITING TO SELL:  [${this.sellClearance} | ${sellClearance}]  ${awaitingSell}
AWAITING TO BUY:   [${this.buyClearance}]  ${awaitingBuy} `;

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

        this.tg_bot.command('set', async (ctx) => {
            const text = ctx.message.text;
            const params = text.split(' ').slice(1);
            const {
                buy = null,
                sell = null,
                volume = null,
                max_volume = null,
            } = params.reduce((acc, param) => {
                const [key, value] = param.split('=');
                acc[key] = value;
                return acc;
            }, {});

            this.sellClearance = Number(sell) || this.sellClearance;
            this.buyClearance = Number(buy) || this.buyClearance;
            this.maxVolume = Number(max_volume) || this.maxVolume;
            this.volume = Number(volume) || this.volume;

            if (volume || buy || sell || max_volume) {
                this.isTrading = false;
                ctx.reply('✅ You changed configuration, the bot is stopped. Run bot to start trading with new percentage.');
            }
        });
    }
}
