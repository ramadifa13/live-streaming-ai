import sys

with open("backend/src/services/live-platform-connector.ts", "r") as f:
    content = f.read()

content = content.replace("const response: any = await generateDynamicSalesResponse(", """const response: any = await generateDynamicSalesResponse({
          userQuestion: text,
          productName: product?.name || "Produk",
          productPrice: product?.price ? `Rp${product.price}` : "",
          productDescription: product?.description || "",
          productCategory: product?.category || "",
          productBenefits: product?.benefits || "",
          productUsage: product?.usage || "",
          productFaq: product?.faq || "",
          productStock: product?.stock || 0,
          avatarName: state.config.avatarName || "Namira",
          tone: state.config.tone || "Persuasif",
        });
        // dummy assignment to fix compilation
        const dummy = """)

content = content.replace("aiResponseText = response.speech;", "aiResponseText = response.replyText;")
content = content.replace("this.globalSpeechCallback?.(response.speech, sessionId);", "this.globalSpeechCallback?.(response.replyText, sessionId);")

with open("backend/src/services/live-platform-connector.ts", "w") as f:
    f.write(content)
