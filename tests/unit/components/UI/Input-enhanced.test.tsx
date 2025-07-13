import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Input, TextArea, Select } from '../../../../src/components/UI';

describe('Enhanced Input Features', () => {
  describe('Password Toggle Functionality', () => {
    it('automatically adds password toggle for password type', () => {
      render(<Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />);

      const toggleButton = screen.getByRole('button', { name: /show password|hide password/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('toggles password visibility when clicked', async () => {
      const user = userEvent.setup();
      render(<Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />);

      const passwordInput = screen.getByLabelText('Password');
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      // Initially should be password type
      expect(passwordInput).toHaveAttribute('type', 'password');

      // Click to show password
      await user.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'text');

      // Click to hide password again
      await user.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('does not add toggle when custom trailing icon is provided', () => {
      render(
        <Input
          type='password'
          label='Password'
          value='secretpassword'
          onChange={vi.fn()}
          trailingIcon={<span>Custom</span>}
          onTrailingIconClick={vi.fn()}
        />
      );

      const customIcon = screen.getByText('Custom');
      expect(customIcon).toBeInTheDocument();

      // Should not have password toggle
      expect(screen.queryByLabelText(/show password|hide password/i)).not.toBeInTheDocument();
    });

    it('maintains proper accessibility for password toggle', () => {
      render(<Input type='password' label='Password' value='secretpassword' onChange={vi.fn()} />);

      const toggleButton = screen.getByRole('button');
      expect(toggleButton).toHaveAttribute(
        'aria-label',
        expect.stringMatching(/show password|hide password/i)
      );
    });
  });

  describe('Search Clear Functionality', () => {
    it('shows clear button when search input has value', () => {
      render(<Input type='search' label='Search' value='search term' onChange={vi.fn()} />);

      const clearButton = screen.getByRole('button', { name: /clear search/i });
      expect(clearButton).toBeInTheDocument();
    });

    it('does not show clear button when search input is empty', () => {
      render(<Input type='search' label='Search' value='' onChange={vi.fn()} />);

      expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument();
    });

    it('clears the input when clear button is clicked', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<Input type='search' label='Search' value='search term' onChange={handleChange} />);

      const clearButton = screen.getByRole('button', { name: /clear search/i });
      await user.click(clearButton);

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ value: '' }),
        })
      );
    });

    it('does not add clear button when custom trailing icon is provided', () => {
      render(
        <Input
          type='search'
          label='Search'
          value='search term'
          onChange={vi.fn()}
          trailingIcon={<span>Custom</span>}
          onTrailingIconClick={vi.fn()}
        />
      );

      const customIcon = screen.getByText('Custom');
      expect(customIcon).toBeInTheDocument();

      // Should not have clear button
      expect(screen.queryByLabelText(/clear search/i)).not.toBeInTheDocument();
    });
  });

  describe('Auto-resize TextArea', () => {
    it('renders TextArea with auto-resize enabled', () => {
      render(<TextArea label='Notes' value='Some text' onChange={vi.fn()} autoResize />);

      const textarea = screen.getByLabelText('Notes');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveStyle({ overflow: 'hidden', resize: 'none' });
    });

    it('applies max height limit for auto-resize', () => {
      render(
        <TextArea
          label='Notes'
          value='Some text'
          onChange={vi.fn()}
          autoResize
          maxAutoHeight={200}
        />
      );

      const textarea = screen.getByLabelText('Notes');
      expect(textarea).toBeInTheDocument();
    });

    it('uses resize property when autoResize is disabled', () => {
      render(<TextArea label='Notes' value='Some text' onChange={vi.fn()} resize='vertical' />);

      const textarea = screen.getByLabelText('Notes');
      expect(textarea).toBeInTheDocument();
    });

    it('handles input events for auto-resize', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<TextArea label='Notes' value='' onChange={handleChange} autoResize />);

      const textarea = screen.getByLabelText('Notes');
      await user.type(textarea, 'New text content');

      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe('Character Count Feature', () => {
    it('shows character count when enabled', () => {
      render(
        <Input label='Bio' value='Hello world' onChange={vi.fn()} maxLength={100} showCharCount />
      );

      expect(screen.getByText('11/100')).toBeInTheDocument();
    });

    it('updates character count as user types', async () => {
      const user = userEvent.setup();
      const [value, setValue] = React.useState('');

      function TestComponent() {
        return (
          <Input
            label='Bio'
            value={value}
            onChange={e => setValue(e.target.value)}
            maxLength={50}
            showCharCount
          />
        );
      }

      render(<TestComponent />);

      const input = screen.getByLabelText('Bio');
      await user.type(input, 'Hello');

      await waitFor(() => {
        expect(screen.getByText('5/50')).toBeInTheDocument();
      });
    });

    it('shows character count for TextArea', () => {
      render(
        <TextArea
          label='Description'
          value='Sample text'
          onChange={vi.fn()}
          maxLength={200}
          showCharCount
        />
      );

      expect(screen.getByText('11/200')).toBeInTheDocument();
    });
  });

  describe('Size Variants', () => {
    it('applies small size class', () => {
      render(<Input label='Small Input' size='small' value='' onChange={vi.fn()} />);

      const input = screen.getByLabelText('Small Input');
      expect(input).toBeInTheDocument();
    });

    it('applies large size class', () => {
      render(<Input label='Large Input' size='large' value='' onChange={vi.fn()} />);

      const input = screen.getByLabelText('Large Input');
      expect(input).toBeInTheDocument();
    });

    it('uses medium size by default', () => {
      render(<Input label='Default Input' value='' onChange={vi.fn()} />);

      const input = screen.getByLabelText('Default Input');
      expect(input).toBeInTheDocument();
    });
  });

  describe('Leading and Trailing Icons', () => {
    it('renders leading icon', () => {
      render(
        <Input
          label='Search'
          value=''
          onChange={vi.fn()}
          leadingIcon={<span data-testid='search-icon'>🔍</span>}
        />
      );

      expect(screen.getByTestId('search-icon')).toBeInTheDocument();
    });

    it('renders trailing icon with click handler', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <Input
          label='Input with Action'
          value=''
          onChange={vi.fn()}
          trailingIcon={<span data-testid='action-icon'>⚡</span>}
          onTrailingIconClick={handleClick}
        />
      );

      const trailingButton = screen.getByRole('button');
      await user.click(trailingButton);

      expect(handleClick).toHaveBeenCalled();
    });

    it('disables trailing icon when input is disabled', () => {
      render(
        <Input
          label='Disabled Input'
          value=''
          onChange={vi.fn()}
          disabled
          trailingIcon={<span>Icon</span>}
          onTrailingIconClick={vi.fn()}
        />
      );

      const trailingButton = screen.getByRole('button');
      expect(trailingButton).toBeDisabled();
    });
  });

  describe('Error and Success States', () => {
    it('displays error message', () => {
      render(
        <Input
          label='Email'
          value='invalid-email'
          onChange={vi.fn()}
          error={true}
          errorMessage='Please enter a valid email'
        />
      );

      expect(screen.getByText('Please enter a valid email')).toBeInTheDocument();

      const input = screen.getByLabelText('Email');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('displays success message', () => {
      render(
        <Input
          label='Username'
          value='validuser'
          onChange={vi.fn()}
          success={true}
          successMessage='Username is available'
        />
      );

      expect(screen.getByText('Username is available')).toBeInTheDocument();
    });

    it('prioritizes error over success message', () => {
      render(
        <Input
          label='Field'
          value='value'
          onChange={vi.fn()}
          error={true}
          errorMessage='Error message'
          success={true}
          successMessage='Success message'
        />
      );

      expect(screen.getByText('Error message')).toBeInTheDocument();
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });

    it('displays helper text when no error or success', () => {
      render(
        <Input
          label='Password'
          value=''
          onChange={vi.fn()}
          helperText='Must be at least 8 characters'
        />
      );

      expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
    });
  });

  describe('Accessibility Features', () => {
    it('generates unique IDs for inputs', () => {
      render(
        <>
          <Input label='First Input' value='' onChange={vi.fn()} />
          <Input label='Second Input' value='' onChange={vi.fn()} />
        </>
      );

      const firstInput = screen.getByLabelText('First Input');
      const secondInput = screen.getByLabelText('Second Input');

      expect(firstInput.id).toBeTruthy();
      expect(secondInput.id).toBeTruthy();
      expect(firstInput.id).not.toBe(secondInput.id);
    });

    it('uses provided ID when given', () => {
      render(<Input id='custom-id' label='Custom Input' value='' onChange={vi.fn()} />);

      const input = screen.getByLabelText('Custom Input');
      expect(input).toHaveAttribute('id', 'custom-id');
    });

    it('associates error message with input via aria-describedby', () => {
      render(
        <Input
          label='Email'
          value=''
          onChange={vi.fn()}
          error={true}
          errorMessage='Invalid email'
        />
      );

      const input = screen.getByLabelText('Email');
      const errorMessage = screen.getByText('Invalid email');

      expect(input).toHaveAttribute('aria-describedby', errorMessage.id);
    });

    it('marks required fields properly', () => {
      render(<Input label='Required Field' value='' onChange={vi.fn()} required />);

      const input = screen.getByLabelText('Required Field');
      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).toBeRequired();
    });
  });

  describe('Form Integration', () => {
    it('forwards ref correctly', () => {
      const ref = React.createRef<HTMLInputElement>();

      render(<Input ref={ref} label='Test Input' value='' onChange={vi.fn()} />);

      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('spreads additional props to input', () => {
      render(
        <Input
          label='Test Input'
          value=''
          onChange={vi.fn()}
          data-testid='custom-input'
          placeholder='Custom placeholder'
        />
      );

      const input = screen.getByTestId('custom-input');
      expect(input).toHaveAttribute('placeholder', 'Custom placeholder');
    });

    it('handles disabled state', () => {
      render(<Input label='Disabled Input' value='' onChange={vi.fn()} disabled />);

      const input = screen.getByLabelText('Disabled Input');
      expect(input).toBeDisabled();
    });

    it('handles readonly state', () => {
      render(<Input label='Readonly Input' value='readonly value' onChange={vi.fn()} readOnly />);

      const input = screen.getByLabelText('Readonly Input');
      expect(input).toHaveAttribute('readonly');
    });
  });
});

describe('Select Component Enhanced Features', () => {
  const sampleOptions = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3', disabled: true },
  ];

  it('renders options from options array', () => {
    render(<Select label='Test Select' value='' onChange={vi.fn()} options={sampleOptions} />);

    expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option 3' })).toBeInTheDocument();
  });

  it('renders placeholder option', () => {
    render(
      <Select
        label='Test Select'
        value=''
        onChange={vi.fn()}
        placeholder='Choose an option'
        options={sampleOptions}
      />
    );

    const placeholderOption = screen.getByRole('option', { name: 'Choose an option' });
    expect(placeholderOption).toBeInTheDocument();
    expect(placeholderOption).toHaveAttribute('disabled');
  });

  it('handles disabled options', () => {
    render(<Select label='Test Select' value='' onChange={vi.fn()} options={sampleOptions} />);

    const disabledOption = screen.getByRole('option', { name: 'Option 3' });
    expect(disabledOption).toBeDisabled();
  });

  it('supports custom option rendering via children', () => {
    render(
      <Select label='Custom Select' value='' onChange={vi.fn()}>
        <option value=''>Select an option</option>
        <option value='custom'>🎨 Custom Option</option>
      </Select>
    );

    expect(screen.getByRole('option', { name: '🎨 Custom Option' })).toBeInTheDocument();
  });

  it('displays error state correctly', () => {
    render(
      <Select
        label='Required Select'
        value=''
        onChange={vi.fn()}
        options={sampleOptions}
        error={true}
        errorMessage='Please select an option'
      />
    );

    expect(screen.getByText('Please select an option')).toBeInTheDocument();

    const select = screen.getByLabelText('Required Select');
    expect(select).toHaveAttribute('aria-invalid', 'true');
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLSelectElement>();

    render(
      <Select ref={ref} label='Test Select' value='' onChange={vi.fn()} options={sampleOptions} />
    );

    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });
});
