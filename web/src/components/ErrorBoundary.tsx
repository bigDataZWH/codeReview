import React from 'react';
import { Alert, Button, Space } from 'antd';
import { useNavigate } from 'react-router-dom';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  navigate: (path: string) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ error: null, errorInfo: null });
    this.props.navigate('/');
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
          <Alert
            type="error"
            message="出错了！"
            description={
              <div>
                <p>{this.state.error.message}</p>
                {this.state.errorInfo && (
                  <details style={{ whiteSpace: 'pre-wrap' }}>
                    <summary>错误堆栈</summary>
                    <div>{this.state.errorInfo.componentStack}</div>
                  </details>
                )}
                <Space style={{ marginTop: 16 }}>
                  <Button type="primary" onClick={this.handleGoHome}>
                    返回首页
                  </Button>
                  <Button onClick={this.handleReload}>
                    重试
                  </Button>
                </Space>
              </div>
            }
          />
        </div>
      );
    }

    return this.props.children;
  }
}

function ErrorBoundaryWrapper({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  return <ErrorBoundary navigate={navigate}>{children}</ErrorBoundary>;
}

export default ErrorBoundaryWrapper;