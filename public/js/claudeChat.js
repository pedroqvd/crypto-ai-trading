// Claude AI Chat Interface
class ClaudeChat {
    constructor() {
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendMessage');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        
        this.isTyping = false;
        this.autoAnalysisEnabled = false;
        this.lastAnalysisTime = 0;
        this.analysisInterval = 300000; // 5 minutes
        
        this.initializeEventListeners();
        this.setupAutoAnalysis();
    }
    
    initializeEventListeners() {
        // Send button click
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => {
                this.sendMessage();
            });
        }
        
        // Enter key to send
        if (this.messageInput) {
            this.messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
                
                // Auto-resize textarea
                this.autoResizeTextarea();
            });
            
            this.messageInput.addEventListener('input', () => {
                this.autoResizeTextarea();
            });
        }
        
        // Auto analysis toggle
        const autoAnalysisBtn = document.getElementById('toggleAutoAnalysis');
        if (autoAnalysisBtn) {
            autoAnalysisBtn.addEventListener('click', () => {
                this.toggleAutoAnalysis();
            });
        }
        
        // Quick action buttons
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleQuickAction(action);
            });
        });
    }
    
    // Auto-resize textarea
    autoResizeTextarea() {
        if (this.messageInput) {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
        }
    }
    
    // Send message to Claude
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isTyping) return;
        
        // Add user message to chat
        this.addUserMessage(message);
        
        // Clear input
        this.messageInput.value = '';
        this.autoResizeTextarea();
        
        // Show loading
        this.setTyping(true);
        
        try {
            // Send to server via WebSocket
            if (window.dashboard && window.dashboard.socket) {
                window.dashboard.sendMessageToClaude(message);
            } else {
                // Fallback to direct API call
                await this.sendDirectMessage(message);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            this.addClaudeMessage('Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.');
            this.setTyping(false);
        }
    }
    
    // Send direct message to Claude API
    async sendDirectMessage(message) {
        try {
            const context = this.gatherMarketContext();
            
            const response = await fetch('/api/claude/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    context: context
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.addClaudeMessage(data.response);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            console.error('Direct message error:', error);
            this.addClaudeMessage('Erro na comunicação com Claude AI. Verifique a conexão.');
        } finally {
            this.setTyping(false);
        }
    }
    
    // Gather market context for Claude
    gatherMarketContext() {
        const context = {
            timestamp: new Date().toISOString(),
            currentAsset: window.dashboard?.currentAsset || 'BTC',
            timeframe: window.dashboard?.currentTimeframe || '1h'
        };
        
        // Add market data if available
        if (window.dashboard && window.dashboard.marketData) {
            context.marketData = Array.from(window.dashboard.marketData.values()).slice(0, 10);
        }
        
        // Add recent alerts
        const alertsContainer = document.getElementById('alertsContainer');
        if (alertsContainer) {
            context.recentAlerts = Array.from(alertsContainer.children)
                .slice(0, 5)
                .map(alert => alert.textContent.trim());
        }
        
        // Add current indicators
        context.indicators = {
            rsi: document.getElementById('rsiValue')?.textContent || 'N/A',
            stochRsi: document.getElementById('stochRsiValue')?.textContent || 'N/A',
            bmsb: document.getElementById('bmsbValue')?.textContent || 'N/A'
        };
        
        return context;
    }
    
    // Add user message to chat
    addUserMessage(message) {
        const messageElement = this.createMessageElement(message, 'user');
        this.appendMessage(messageElement);
    }
    
    // Add Claude message to chat
    addClaudeMessage(message) {
        const messageElement = this.createMessageElement(message, 'claude');
        this.appendMessage(messageElement);
        this.setTyping(false);
    }
    
    // Create message element
    createMessageElement(content, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = sender === 'claude' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        const messageText = document.createElement('div');
        messageText.className = 'message-text';
        
        // Format message content
        if (sender === 'claude') {
            messageText.innerHTML = this.formatClaudeMessage(content);
        } else {
            messageText.textContent = content;
        }
        
        const messageTime = document.createElement('div');
        messageTime.className = 'message-time';
        messageTime.textContent = new Date().toLocaleTimeString();
        
        messageContent.appendChild(messageText);
        messageContent.appendChild(messageTime);
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(messageContent);
        
        return messageDiv;
    }
    
    // Format Claude's response with proper styling
    formatClaudeMessage(content) {
        // Convert markdown-like formatting
        let formatted = content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
        
        // Add emoji and formatting for trading terms
        formatted = formatted
            .replace(/\b(BTC|Bitcoin)\b/g, '₿ $1')
            .replace(/\b(ETH|Ethereum)\b/g, 'Ξ $1')
            .replace(/\b(bullish|bull)\b/gi, '🐂 $1')
            .replace(/\b(bearish|bear)\b/gi, '🐻 $1')
            .replace(/\b(buy|compra)\b/gi, '📈 $1')
            .replace(/\b(sell|venda)\b/gi, '📉 $1')
            .replace(/\b(signal|sinal)\b/gi, '🎯 $1')
            .replace(/\b(alert|alerta)\b/gi, '⚠️ $1')
            .replace(/\b(risk|risco)\b/gi, '⚠️ $1')
            .replace(/\b(opportunity|oportunidade)\b/gi, '💡 $1');
        
        return formatted;
    }
    
    // Append message to chat
    appendMessage(messageElement) {
        if (this.chatMessages) {
            this.chatMessages.appendChild(messageElement);
            this.scrollToBottom();
        }
    }
    
    // Scroll chat to bottom
    scrollToBottom() {
        if (this.chatMessages) {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }
    }
    
    // Set typing indicator
    setTyping(isTyping) {
        this.isTyping = isTyping;
        
        if (this.sendButton) {
            this.sendButton.disabled = isTyping;
            this.sendButton.innerHTML = isTyping 
                ? '<i class="fas fa-circle-notch fa-spin"></i>' 
                : '<i class="fas fa-paper-plane"></i>';
        }
        
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.toggle('active', isTyping);
        }
        
        // Add typing indicator message
        if (isTyping) {
            this.addTypingIndicator();
        } else {
            this.removeTypingIndicator();
        }
    }
    
    // Add typing indicator
    addTypingIndicator() {
        // Remove existing typing indicator
        this.removeTypingIndicator();
        
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message claude-message typing-indicator';
        typingDiv.id = 'typing-indicator';
        
        typingDiv.innerHTML = `
            <div class="message-avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div class="message-content">
                <div class="message-text">
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                    Claude está analisando...
                </div>
            </div>
        `;
        
        // Add CSS for typing animation
        const style = document.createElement('style');
        style.textContent = `
            .typing-dots {
                display: inline-flex;
                gap: 2px;
                margin-right: 8px;
            }
            .typing-dots span {
                width: 4px;
                height: 4px;
                background: #00d4ff;
                border-radius: 50%;
                animation: typing 1.4s infinite;
            }
            .typing-dots span:nth-child(1) { animation-delay: 0.0s; }
            .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
            .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes typing {
                0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
                30% { transform: translateY(-10px); opacity: 1; }
            }
        `;
        
        if (!document.getElementById('typing-animation-style')) {
            style.id = 'typing-animation-style';
            document.head.appendChild(style);
        }
        
        this.appendMessage(typingDiv);
    }
    
    // Remove typing indicator
    removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    // Handle quick actions
    handleQuickAction(action) {
        const actions = {
            'analyze': this.generateMarketAnalysisPrompt(),
            'signals': this.generateSignalsPrompt(),
            'risks': this.generateRiskAnalysisPrompt()
        };
        
        if (actions[action]) {
            this.messageInput.value = actions[action];
            this.sendMessage();
        }
    }
    
    // Generate market analysis prompt
    generateMarketAnalysisPrompt() {
        const currentAsset = window.dashboard?.currentAsset || 'BTC';
        return `Analise as condições atuais do mercado para ${currentAsset} e os principais indicadores técnicos. 
        Considere RSI, Stochastic RSI e BMSB. Quais são suas principais observações e recomendações?`;
    }
    
    // Generate signals prompt
    generateSignalsPrompt() {
        return `Com base nos indicadores técnicos atuais (RSI, Stochastic RSI, BMSB), 
        quais são os sinais de trading mais relevantes? Há alguma oportunidade clara de entrada ou saída?`;
    }
    
    // Generate risk analysis prompt
    generateRiskAnalysisPrompt() {
        return `Avalie os riscos atuais do mercado cripto. Considerando a volatilidade, 
        indicadores técnicos e condições gerais, quais são os principais pontos de atenção e como se proteger?`;
    }
    
    // Toggle auto analysis
    toggleAutoAnalysis() {
        this.autoAnalysisEnabled = !this.autoAnalysisEnabled;
        
        const btn = document.getElementById('toggleAutoAnalysis');
        if (btn) {
            btn.classList.toggle('active', this.autoAnalysisEnabled);
            btn.innerHTML = this.autoAnalysisEnabled 
                ? '<i class="fas fa-magic"></i> Auto Analysis ON'
                : '<i class="fas fa-magic"></i> Auto Analysis OFF';
        }
        
        if (this.autoAnalysisEnabled) {
            this.addClaudeMessage('✨ Auto-análise ativada! Vou analisar automaticamente o mercado a cada 5 minutos.');
            this.scheduleAutoAnalysis();
        } else {
            this.addClaudeMessage('Auto-análise desativada.');
        }
    }
    
    // Setup auto analysis
    setupAutoAnalysis() {
        setInterval(() => {
            if (this.autoAnalysisEnabled && !this.isTyping) {
                const now = Date.now();
                if (now - this.lastAnalysisTime >= this.analysisInterval) {
                    this.performAutoAnalysis();
                    this.lastAnalysisTime = now;
                }
            }
        }, 60000); // Check every minute
    }
    
    // Schedule next auto analysis
    scheduleAutoAnalysis() {
        this.lastAnalysisTime = Date.now();
    }
    
    // Perform automatic analysis
    performAutoAnalysis() {
        const prompt = this.generateAutoAnalysisPrompt();
        
        // Add analysis message
        this.addClaudeMessage('🔄 Realizando análise automática do mercado...');
        
        // Send analysis request
        setTimeout(() => {
            this.messageInput.value = prompt;
            this.sendMessage();
        }, 1000);
    }
    
    // Generate auto analysis prompt
    generateAutoAnalysisPrompt() {
        const currentAsset = window.dashboard?.currentAsset || 'BTC';
        const marketCount = window.dashboard?.marketData?.size || 0;
        
        return `Análise automática ${new Date().toLocaleTimeString()}: 
        Faça um resumo rápido das condições de ${currentAsset} e dos ${marketCount} ativos monitorados. 
        Destaque mudanças significativas nos indicadores e possíveis oportunidades. Seja conciso mas informativo.`;
    }
    
    // Clear chat
    clearChat() {
        if (this.chatMessages) {
            // Keep welcome message
            const welcomeMessage = this.chatMessages.querySelector('.claude-message');
            this.chatMessages.innerHTML = '';
            
            if (welcomeMessage) {
                this.chatMessages.appendChild(welcomeMessage);
            }
        }
        
        // Reset counters
        if (window.dashboard) {
            window.dashboard.claudeResponseCount = 0;
            const element = document.getElementById('claudeResponseCount');
            if (element) {
                element.textContent = '0';
            }
        }
    }
    
    // Add system message
    addSystemMessage(message, type = 'info') {
        const messageElement = document.createElement('div');
        messageElement.className = 'message system-message';
        messageElement.innerHTML = `
            <div class="message-content" style="background: rgba(255,255,255,0.1); text-align: center; font-style: italic;">
                <div class="message-text">${message}</div>
                <div class="message-time">${new Date().toLocaleTimeString()}</div>
            </div>
        `;
        
        this.appendMessage(messageElement);
    }
    
    // Handle market alerts for auto-analysis
    handleMarketAlert(alert) {
        if (this.autoAnalysisEnabled && !this.isTyping) {
            // Trigger analysis for significant alerts
            if (alert.includes('Strong') || alert.includes('Signal')) {
                const prompt = `Acabei de receber este alerta: "${alert}". 
                Pode explicar o que isso significa e se devo tomar alguma ação?`;
                
                setTimeout(() => {
                    this.messageInput.value = prompt;
                    this.sendMessage();
                }, 2000);
            }
        }
    }
}

// Initialize Claude Chat
document.addEventListener('DOMContentLoaded', function() {
    window.claudeChat = new ClaudeChat();
    console.log('🤖 Claude AI Chat initialized');
});

// Export for global access
window.ClaudeChat = ClaudeChat;