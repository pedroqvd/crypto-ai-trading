// ================================================
// CRYPTO AI TRADING DASHBOARD
// Versão com TradingView Widgets
// ================================================

class CryptoDashboard {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.analysisCount = 0;
        this.currentPrices = {};
        
        this.initializeSocket();
        this.bindEvents();
        this.startPeriodicUpdates();
        
        console.log('🚀 Dashboard iniciado com TradingView!');
    }

    // ========================================
    // SOCKET.IO CONNECTION
    // ========================================
    initializeSocket() {
        try {
            this.socket = io();
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.updateConnectionStatus('Conectado', true);
                console.log('✅ Socket.IO conectado');
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.updateConnectionStatus('Desconectado', false);
                console.log('❌ Socket.IO desconectado');
            });

            this.socket.on('analysisUpdate', (data) => {
                this.handleAnalysisUpdate(data);
            });

            this.socket.on('priceUpdate', (data) => {
                this.handlePriceUpdate(data);
            });

            this.socket.on('claudeResponse', (data) => {
                this.handleClaudeResponse(data);
            });

        } catch (error) {
            console.error('❌ Erro ao conectar Socket.IO:', error);
            this.updateConnectionStatus('Erro de Conexão', false);
        }
    }

    // ========================================
    // UI UPDATES
    // ========================================
    updateConnectionStatus(status, isConnected) {
        const statusElement = document.getElementById('status-text');
        const connectionStatus = document.getElementById('connection-status');
        
        if (statusElement) {
            statusElement.textContent = status;
        }
        
        if (connectionStatus) {
            connectionStatus.textContent = isConnected ? 'Online' : 'Offline';
            connectionStatus.style.color = isConnected ? '#00ff88' : '#ff4444';
        }

        // Atualizar dot de status
        const statusDot = document.querySelector('.status-dot');
        if (statusDot) {
            statusDot.style.background = isConnected ? '#00ff88' : '#ff4444';
        }
    }

    updateAnalysisCount() {
        const countElement = document.getElementById('analysis-count');
        if (countElement) {
            countElement.textContent = this.analysisCount;
        }
    }

    // ========================================
    // DATA HANDLERS
    // ========================================
    handleAnalysisUpdate(data) {
        console.log('📊 Análise recebida:', data);
        this.analysisCount++;
        this.updateAnalysisCount();
        
        // Mostrar notificação de análise
        this.showAnalysisNotification(data);
    }

    handlePriceUpdate(data) {
        console.log('💰 Preços atualizados:', data);
        this.currentPrices = { ...this.currentPrices, ...data };
    }

    handleClaudeResponse(data) {
        console.log('🤖 Claude respondeu:', data);
        this.addChatMessage(data.message, 'claude');
    }

    // ========================================
    // ANÁLISES E AÇÕES
    // ========================================
    async runAnalysis() {
        try {
            console.log('🔄 Executando análise completa...');
            
            const response = await fetch('/api/analysis/complete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.showNotification('✅ Análise concluída!', 'success');
                this.handleAnalysisUpdate(data);
            } else {
                throw new Error('Erro na análise');
            }
        } catch (error) {
            console.error('❌ Erro na análise:', error);
            this.showNotification('❌ Erro na análise', 'error');
        }
    }

    async updatePrices() {
        try {
            console.log('🔄 Atualizando preços...');
            
            const response = await fetch('/api/market/prices');
            if (response.ok) {
                const data = await response.json();
                this.handlePriceUpdate(data);
                this.showNotification('✅ Preços atualizados!', 'success');
            } else {
                throw new Error('Erro ao buscar preços');
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar preços:', error);
            this.showNotification('❌ Erro ao atualizar preços', 'error');
        }
    }

    async exportData() {
        try {
            console.log('📊 Exportando dados...');
            
            const data = {
                prices: this.currentPrices,
                analysisCount: this.analysisCount,
                timestamp: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `crypto-data-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            
            URL.revokeObjectURL(url);
            this.showNotification('✅ Dados exportados!', 'success');
            
        } catch (error) {
            console.error('❌ Erro ao exportar:', error);
            this.showNotification('❌ Erro na exportação', 'error');
        }
    }

    // ========================================
    // CHAT CLAUDE AI
    // ========================================
    async sendMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message) return;
        
        // Adicionar mensagem do usuário
        this.addChatMessage(message, 'user');
        input.value = '';
        
        try {
            const response = await fetch('/api/claude/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message })
            });

            if (response.ok) {
                const data = await response.json();
                this.addChatMessage(data.response, 'claude');
            } else {
                this.addChatMessage('Erro ao conectar com Claude AI (modo demo)', 'error');
            }
        } catch (error) {
            console.error('❌ Erro no chat:', error);
            this.addChatMessage('Claude AI em modo simulação', 'claude');
        }
    }

    addChatMessage(message, type) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        const messageDiv = document.createElement('div');
        messageDiv.style.marginBottom = '10px';
        messageDiv.style.padding = '8px';
        messageDiv.style.borderRadius = '5px';
        
        switch (type) {
            case 'user':
                messageDiv.style.background = 'rgba(0, 255, 136, 0.2)';
                messageDiv.style.textAlign = 'right';
                messageDiv.innerHTML = `<strong>Você:</strong> ${message}`;
                break;
            case 'claude':
                messageDiv.style.background = 'rgba(65, 105, 225, 0.2)';
                messageDiv.innerHTML = `<strong>🤖 Claude:</strong> ${message}`;
                break;
            case 'error':
                messageDiv.style.background = 'rgba(255, 68, 68, 0.2)';
                messageDiv.innerHTML = `<strong>⚠️ Sistema:</strong> ${message}`;
                break;
        }
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ========================================
    // NOTIFICAÇÕES
    // ========================================
    showNotification(message, type = 'info') {
        // Criar notificação temporária
        const notification = document.createElement('div');
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.