import { buildGptConfig } from "../src/core/gpt-config.js";

const config = buildGptConfig("zh-CN");

const content = `# TokenPilot GPT 指令草稿

以下内容可直接粘贴到 GPT 编辑页主说明框。你也可以根据自己的习惯手动修改。

当前显示版本：${config.version}
当前产品版本：${config.productVersion}
当前指令与 Schema 修订：${config.schemaVersion}
当前构建时间版本：${config.buildVersion}
当前生成时间：${config.updatedAt}
当前 OpenAPI 地址：${config.openapiUrl}
当前公开基址：${config.publicBaseUrl ?? "仅本地 / 未暴露"}
当前动作主机：${config.actionHost}

${config.instructions}
`;

process.stdout.write(content);
