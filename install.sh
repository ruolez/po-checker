#!/bin/bash

# PO Checker Installation Script for Ubuntu 24 LTS
# Usage: curl -fsSL https://raw.githubusercontent.com/ruolez/po-checker/main/install.sh | sudo bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="po-checker"
INSTALL_DIR="/opt/${APP_NAME}"
REPO_URL="https://github.com/ruolez/po-checker.git"
DATA_DIR="${INSTALL_DIR}/data"

# Print colored message
print_msg() {
    echo -e "${2}${1}${NC}"
}

# Print header
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  PO Checker - Warehouse Receiving App  ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_msg "Please run as root (use sudo)" "$RED"
        exit 1
    fi
}

# Get local IP address
get_local_ip() {
    ip route get 1 | awk '{print $7; exit}' 2>/dev/null || hostname -I | awk '{print $1}'
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        return 1
    fi
    return 0
}

# Install Docker
install_docker() {
    print_msg "Installing Docker..." "$YELLOW"

    # Remove old versions
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Install prerequisites
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Set up repository
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start and enable Docker
    systemctl start docker
    systemctl enable docker

    print_msg "Docker installed successfully!" "$GREEN"
}

# Clean up unused Docker images
cleanup_docker_images() {
    print_msg "Cleaning up unused Docker images..." "$YELLOW"
    docker image prune -af 2>/dev/null || true
    docker system prune -f 2>/dev/null || true
    print_msg "Cleanup complete!" "$GREEN"
}

# Install application
install_app() {
    print_msg "Installing PO Checker..." "$YELLOW"

    # Check if already installed
    if [ -d "$INSTALL_DIR" ]; then
        print_msg "Application already installed at ${INSTALL_DIR}" "$RED"
        print_msg "Use 'Update' option to update or 'Remove' to uninstall first." "$YELLOW"
        return 1
    fi

    # Get IP address
    LOCAL_IP=$(get_local_ip)
    echo ""
    read -p "Enter IP address for the application [$LOCAL_IP]: " INPUT_IP
    IP_ADDRESS=${INPUT_IP:-$LOCAL_IP}

    # Validate IP
    if ! [[ $IP_ADDRESS =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        print_msg "Invalid IP address format!" "$RED"
        return 1
    fi

    # Clone repository
    print_msg "Cloning repository..." "$YELLOW"
    git clone "$REPO_URL" "$INSTALL_DIR"

    # Create data directory for persistent storage
    mkdir -p "$DATA_DIR"

    # Update docker-compose to use port 80
    sed -i 's/"8080:80"/"80:80"/g' "${INSTALL_DIR}/docker-compose.yml"

    # Build and start containers
    cd "$INSTALL_DIR"
    print_msg "Building Docker containers..." "$YELLOW"
    docker compose build --no-cache

    print_msg "Starting application..." "$YELLOW"
    docker compose up -d

    # Clean up build cache
    cleanup_docker_images

    # Wait for services to start
    sleep 5

    # Check if running
    if docker compose ps | grep -q "running"; then
        echo ""
        print_msg "========================================" "$GREEN"
        print_msg "  Installation Complete!" "$GREEN"
        print_msg "========================================" "$GREEN"
        echo ""
        print_msg "Access the application at:" "$BLUE"
        print_msg "  http://${IP_ADDRESS}" "$GREEN"
        echo ""
        print_msg "Configure database connections in Settings" "$YELLOW"
        echo ""
    else
        print_msg "Warning: Some containers may not be running." "$YELLOW"
        print_msg "Check logs with: docker compose -f ${INSTALL_DIR}/docker-compose.yml logs" "$YELLOW"
    fi
}

# Update application
update_app() {
    print_msg "Updating PO Checker..." "$YELLOW"

    # Check if installed
    if [ ! -d "$INSTALL_DIR" ]; then
        print_msg "Application not installed!" "$RED"
        print_msg "Use 'Install' option first." "$YELLOW"
        return 1
    fi

    cd "$INSTALL_DIR"

    # Backup PostgreSQL data (settings are stored here)
    print_msg "Backing up configuration..." "$YELLOW"
    BACKUP_DIR="/tmp/${APP_NAME}_backup_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"

    # Export PostgreSQL data if container is running
    if docker compose ps postgres 2>/dev/null | grep -q "running"; then
        docker compose exec -T postgres pg_dump -U pochecker pochecker > "${BACKUP_DIR}/database_backup.sql" 2>/dev/null || true
        print_msg "Database backed up to ${BACKUP_DIR}" "$GREEN"
    fi

    # Stop containers
    print_msg "Stopping containers..." "$YELLOW"
    docker compose down

    # Pull latest code
    print_msg "Pulling latest code from GitHub..." "$YELLOW"
    git fetch origin
    git reset --hard origin/main

    # Restore port 80 setting
    sed -i 's/"8080:80"/"80:80"/g' "${INSTALL_DIR}/docker-compose.yml"

    # Rebuild containers
    print_msg "Rebuilding containers..." "$YELLOW"
    docker compose build --no-cache

    # Start containers
    print_msg "Starting application..." "$YELLOW"
    docker compose up -d

    # Restore database if backup exists
    if [ -f "${BACKUP_DIR}/database_backup.sql" ]; then
        sleep 5  # Wait for PostgreSQL to be ready
        print_msg "Restoring database..." "$YELLOW"
        docker compose exec -T postgres psql -U pochecker pochecker < "${BACKUP_DIR}/database_backup.sql" 2>/dev/null || true
        print_msg "Database restored!" "$GREEN"
    fi

    # Clean up unused images
    cleanup_docker_images

    # Clean up backup
    rm -rf "$BACKUP_DIR"

    echo ""
    print_msg "========================================" "$GREEN"
    print_msg "  Update Complete!" "$GREEN"
    print_msg "========================================" "$GREEN"
    echo ""
    print_msg "Your settings have been preserved." "$BLUE"
    echo ""
}

# Remove application
remove_app() {
    print_msg "Removing PO Checker..." "$YELLOW"

    # Check if installed
    if [ ! -d "$INSTALL_DIR" ]; then
        print_msg "Application not installed!" "$RED"
        return 1
    fi

    # Confirm removal
    echo ""
    read -p "Are you sure you want to remove PO Checker? This will delete all data! (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        print_msg "Removal cancelled." "$YELLOW"
        return 0
    fi

    cd "$INSTALL_DIR"

    # Stop and remove containers
    print_msg "Stopping and removing containers..." "$YELLOW"
    docker compose down -v --remove-orphans 2>/dev/null || true

    # Remove application directory
    print_msg "Removing application files..." "$YELLOW"
    rm -rf "$INSTALL_DIR"

    # Clean up unused Docker images
    cleanup_docker_images

    echo ""
    print_msg "========================================" "$GREEN"
    print_msg "  Removal Complete!" "$GREEN"
    print_msg "========================================" "$GREEN"
    echo ""
    print_msg "PO Checker has been completely removed." "$BLUE"
    echo ""
}

# Show status
show_status() {
    print_msg "PO Checker Status" "$BLUE"
    echo ""

    if [ ! -d "$INSTALL_DIR" ]; then
        print_msg "Application not installed." "$YELLOW"
        return 0
    fi

    cd "$INSTALL_DIR"

    print_msg "Installation directory: ${INSTALL_DIR}" "$GREEN"
    echo ""

    print_msg "Container Status:" "$BLUE"
    docker compose ps
    echo ""

    # Check if running
    if docker compose ps | grep -q "running"; then
        LOCAL_IP=$(get_local_ip)
        print_msg "Application URL: http://${LOCAL_IP}" "$GREEN"
    else
        print_msg "Application is not running." "$YELLOW"
        print_msg "Start with: cd ${INSTALL_DIR} && docker compose up -d" "$YELLOW"
    fi
    echo ""
}

# Show logs
show_logs() {
    if [ ! -d "$INSTALL_DIR" ]; then
        print_msg "Application not installed." "$YELLOW"
        return 0
    fi

    cd "$INSTALL_DIR"
    docker compose logs --tail=100 -f
}

# Main menu
main_menu() {
    print_header

    echo "Please select an option:"
    echo ""
    echo "  1) Install     - Fresh installation"
    echo "  2) Update      - Update from GitHub (preserves settings)"
    echo "  3) Remove      - Completely uninstall"
    echo "  4) Status      - Show application status"
    echo "  5) Logs        - View application logs"
    echo "  6) Exit"
    echo ""
    read -p "Enter choice [1-6]: " choice

    case $choice in
        1)
            if ! check_docker; then
                install_docker
            fi
            install_app
            ;;
        2)
            update_app
            ;;
        3)
            remove_app
            ;;
        4)
            show_status
            ;;
        5)
            show_logs
            ;;
        6)
            print_msg "Goodbye!" "$GREEN"
            exit 0
            ;;
        *)
            print_msg "Invalid option!" "$RED"
            exit 1
            ;;
    esac
}

# Run
check_root
main_menu
