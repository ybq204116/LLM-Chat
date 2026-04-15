// 定义可用的工具
export const availableTools = [
    {
        type: "function",
        function: {
            name: "get_current_time",
            description: "获取当前北京时间",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "calculate",
            description: "简单的数学运算，评估数学表达式",
            parameters: {
                type: "object",
                properties: {
                    expression: {
                        type: "string",
                        description: "合法的数学表达式，例如: 12411 * 899，可包含四则运算等"
                    }
                },
                required: ["expression"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_random_number",
            description: "生成指定范围内的随机整数",
            parameters: {
                type: "object",
                properties: {
                    min: { type: "number", description: "最小值（包含）" },
                    max: { type: "number", description: "最大值（包含）" }
                },
                required: ["min", "max"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_uuid",
            description: "生成一个随机的 UUID v4 字符串，可用于唯一标识符场景",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "base64_encode",
            description: "将普通文本字符串编码为 Base64 格式",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string", description: "要编码的原始文本" }
                },
                required: ["text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "base64_decode",
            description: "将 Base64 字符串解码为原始文本",
            parameters: {
                type: "object",
                properties: {
                    encoded: { type: "string", description: "要解码的 Base64 字符串" }
                },
                required: ["encoded"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "format_json",
            description: "将压缩或混乱的 JSON 字符串格式化（美化）并返回可读结构",
            parameters: {
                type: "object",
                properties: {
                    json_string: { type: "string", description: "要格式化的 JSON 字符串" }
                },
                required: ["json_string"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "count_text",
            description: "统计给定文本的字符数、单词数和行数",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string", description: "要统计的文本内容" }
                },
                required: ["text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "convert_color",
            description: "在 HEX 和 RGB 颜色格式之间互相转换",
            parameters: {
                type: "object",
                properties: {
                    color: {
                        type: "string",
                        description: "颜色值，例如 '#FF5733' 或 'rgb(255, 87, 51)'"
                    }
                },
                required: ["color"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "url_encode",
            description: "将文本进行 URL 编码（百分号编码），适合处理含有特殊字符的 URL 参数",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string", description: "要编码的原始文本" }
                },
                required: ["text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "url_decode",
            description: "将 URL 编码（百分号编码）的文本解码回原始字符串",
            parameters: {
                type: "object",
                properties: {
                    encoded: { type: "string", description: "要解码的 URL 编码字符串" }
                },
                required: ["encoded"]
            }
        }
    }
];

// 执行对应的工具
export const executeTool = async (name: string, argsStr: string): Promise<string> => {
    try {
        const args = argsStr ? JSON.parse(argsStr) : {};

        console.log(`[Plugin Execution] 正在执行 ${name}，参数:`, args);

        switch (name) {
            case 'get_current_time':
                return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

            case 'calculate': {
                const exp = args.expression as string;
                if (!/^[0-9+\-*/().\s]+$/.test(exp)) {
                    return "计算错误：包含不安全的字符，仅支持基本数字与数学符号。";
                }
                // eslint-disable-next-line no-eval
                const result = eval(exp);
                return `计算结果：${result}`;
            }

            case 'generate_random_number': {
                const min = Math.ceil(args.min as number);
                const max = Math.floor(args.max as number);
                if (min > max) return "错误：最小值不能大于最大值。";
                const rand = Math.floor(Math.random() * (max - min + 1)) + min;
                return `在 ${min} 到 ${max} 之间生成的随机数为：${rand}`;
            }

            case 'generate_uuid': {
                const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                    const r = (Math.random() * 16) | 0;
                    const v = c === 'x' ? r : (r & 0x3) | 0x8;
                    return v.toString(16);
                });
                return `生成的 UUID：${uuid}`;
            }

            case 'base64_encode': {
                const encoded = btoa(unescape(encodeURIComponent(args.text as string)));
                return `Base64 编码结果：${encoded}`;
            }

            case 'base64_decode': {
                const decoded = decodeURIComponent(escape(atob(args.encoded as string)));
                return `Base64 解码结果：${decoded}`;
            }

            case 'format_json': {
                const parsed = JSON.parse(args.json_string as string);
                const formatted = JSON.stringify(parsed, null, 2);
                return `格式化后的 JSON：\n\`\`\`json\n${formatted}\n\`\`\``;
            }

            case 'count_text': {
                const text = args.text as string;
                const charCount = text.length;
                const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
                const lineCount = text.split('\n').length;
                return `文本统计结果：字符数 ${charCount}，单词/词组数 ${wordCount}，行数 ${lineCount}。`;
            }

            case 'convert_color': {
                const color = (args.color as string).trim();
                if (color.startsWith('#')) {
                    const hex = color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16);
                    const g = parseInt(hex.substring(2, 4), 16);
                    const b = parseInt(hex.substring(4, 6), 16);
                    return `HEX ${color} 对应的 RGB 值为：rgb(${r}, ${g}, ${b})`;
                }
                const match = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
                if (match) {
                    const r = parseInt(match[1]).toString(16).padStart(2, '0');
                    const g = parseInt(match[2]).toString(16).padStart(2, '0');
                    const b = parseInt(match[3]).toString(16).padStart(2, '0');
                    return `RGB ${color} 对应的 HEX 值为：#${r}${g}${b}`;
                }
                return `无法识别的颜色格式：${color}，请使用 '#RRGGBB' 或 'rgb(r, g, b)' 格式。`;
            }

            case 'url_encode': {
                const encoded = encodeURIComponent(args.text as string);
                return `URL 编码结果：${encoded}`;
            }

            case 'url_decode': {
                const decoded = decodeURIComponent(args.encoded as string);
                return `URL 解码结果：${decoded}`;
            }

            default:
                return `执行失败：找不到该工具 ${name}`;
        }
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        return `执行错误：工具报错 - ${errorMsg}`;
    }
};
