# Deploy — Oracle Cloud Always Free

Guia passo-a-passo para colocar o bot rodando na VM Oracle Cloud (Oracle Linux 9).

---

## Pré-requisitos

- VM criada na Oracle Cloud (VM.Standard.E2.1.Micro)
- Arquivo de chave privada SSH baixado (`.key` ou `.pem`)
- IP público da VM (visível no painel Oracle Cloud)

---

## Passo 1 — Acessar a VM via SSH

### No Windows (PowerShell ou CMD)
```bash
# Substitua <CAMINHO_CHAVE> e <IP_DA_VM> pelos seus valores
ssh -i C:\Users\SeuUsuario\Downloads\ssh-key.key opc@<IP_DA_VM>
```

### No Mac / Linux (Terminal)
```bash
# Ajusta permissão da chave (obrigatório — senão SSH rejeita)
chmod 400 ~/Downloads/ssh-key.key

ssh -i ~/Downloads/ssh-key.key opc@<IP_DA_VM>
```

> Na primeira conexão vai perguntar "Are you sure you want to continue connecting?" — digite `yes`.

---

## Passo 2 — Liberar a Porta 3000 no Firewall

### 2a. Firewall do Oracle Cloud (Security List)

1. No painel Oracle → **Networking** → **Virtual Cloud Networks**
2. Clique na sua VCN → **Security Lists** → **Default Security List**
3. Clique em **Add Ingress Rules** e adicione:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: `TCP`
   - Destination Port Range: `3000`
4. Salve.

### 2b. Firewall do Sistema Operacional (Oracle Linux 9)

```bash
# Na VM via SSH:
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# Verifica se a porta está liberada
sudo firewall-cmd --list-ports
```

---

## Passo 3 — Instalar Docker

```bash
# Instala o Docker via repositório oficial
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Inicia o Docker e configura para iniciar no boot
sudo systemctl enable --now docker

# Adiciona seu usuário ao grupo docker (evita usar sudo toda hora)
sudo usermod -aG docker opc

# IMPORTANTE: faça logout e login novamente para o grupo ter efeito
exit
```

Reconecte à VM (repita o comando SSH do Passo 1).

---

## Passo 4 — Clonar o Repositório

```bash
# Instala git (se não estiver instalado)
sudo dnf install -y git

# Clona o repositório
cd ~
git clone https://github.com/pedroqvd/crypto-ai-trading.git
cd crypto-ai-trading
```

---

## Passo 5 — Configurar o Arquivo .env

```bash
# Cria o .env a partir do exemplo
cp .env.example .env

# Abre o editor para preencher os valores
nano .env
```

Campos obrigatórios a preencher:

| Campo | Valor |
|-------|-------|
| `PRIVATE_KEY` | Chave privada da sua carteira Polygon (começa com `0x`) |
| `DRY_RUN` | `true` para testar sem trades reais |
| `AUTH_EMAIL` | Seu email para login no dashboard |
| `AUTH_PASSWORD_HASH` | Gerado no Passo 6 |
| `JWT_SECRET` | Gerado no Passo 6 |

Para salvar no `nano`: **Ctrl+O** → Enter → **Ctrl+X**

---

## Passo 6 — Gerar Credenciais do Dashboard

```bash
# Instala Node.js para gerar as credenciais de auth
sudo dnf install -y nodejs

# Instala dependências temporariamente
npm install

# Gera AUTH_PASSWORD_HASH e JWT_SECRET automaticamente
npx ts-node src/auth/setup.ts
```

O script vai imprimir os valores — copie e cole no `.env`.

---

## Passo 7 — Subir o Bot com Docker

```bash
# Cria os diretórios persistentes
mkdir -p data logs

# Constrói a imagem e sobe o container em background
docker compose up -d --build

# Verifica se está rodando
docker compose ps
```

Aguarde ~60 segundos e acesse o dashboard:
```
http://<IP_DA_VM>:3000
```

---

## Comandos do Dia a Dia

```bash
# Ver status do container
docker compose ps

# Ver logs em tempo real
docker compose logs -f

# Ver apenas os últimos 50 logs
docker compose logs --tail=50

# Reiniciar o bot
docker compose restart

# Parar o bot
docker compose down

# Atualizar o bot (após git pull)
git pull origin main
docker compose up -d --build

# Ver uso de memória/CPU
docker stats polymarket-bot
```

---

## Troubleshooting

### Container para de funcionar
```bash
# Veja o motivo do crash
docker compose logs --tail=100
```

### Dashboard não abre
```bash
# Confirma que a porta está mapeada
docker compose ps
# Deve mostrar: 0.0.0.0:3000->3000/tcp

# Confirma que o firewall OL9 está OK
sudo firewall-cmd --list-ports
```

### Sem memória
```bash
# Ver uso atual
free -h
docker stats --no-stream

# Se precisar, adicione swap (1GB extra)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Segurança

- **Nunca commite o `.env`** — ele está no `.gitignore`
- A chave SSH é o único acesso à VM — guarde o arquivo `.key` em local seguro
- O bot roda como usuário não-root dentro do container
- O dashboard exige autenticação via JWT (email + senha)
