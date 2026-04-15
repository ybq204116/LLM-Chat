import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    title: {
        type: String,
        default: '无标题笔记',
    },
    content: {
        type: String,
        default: '',
    },
    isPinned: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

noteSchema.pre('save', function () {
    this.updatedAt = new Date();
});

export const Note = mongoose.model('Note', noteSchema);