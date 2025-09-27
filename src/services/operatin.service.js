import operation from '../../db/models/Operations.js';

class OperationService {
    constructor() {
        this.operationModel = operation;
    }

    // pair, totalSpent, averageBuyPrice
    async create(params) {
        try {
            const operation = new this.operationModel(params);
            await operation.save();

            return { operation, success: true };
        } catch (e) {
            return { message: e.message, success: false };
        }
    }

    async get(pair) {
        try {
            const oparation = await this.operationModel.findOne({ pair }).select(['averageBuyPrice', 'amount', 'totalSpent']).lean();

            return oparation ? { ...oparation, success: true } : { success: false };
        } catch (e) {
            return { message: e.message, success: false };
        }
    }

    async update({ pair, totalSpent, averageBuyPrice, amount }) {
        try {
            const operation = await this.operationModel.findOneAndUpdate({ pair }, { totalSpent, averageBuyPrice, amount, $inc: { bayCount: 1 } }, { new: true, upsert: true });

            return { operation, success: true };
        } catch (e) {
            return { message: e.message, success: false };
        }
    }

    async reset(pair) {
        try {
            const operation = await this.operationModel.findOneAndUpdate({ pair }, { amount: 0, totalSpent: 0, averageBuyPrice: 0, $inc: { sellCount: 1 } });

            return { operation, success: true };
        } catch (e) {
            return { message: e.message, success: false };
        }
    }
}

export default new OperationService();
